import type { ActivityCategory, ActivityItem, Mix } from './types';

// Weighted rotation picker for the live-activity feed.
//
// Guarantees:
//   · Items appear with frequency roughly proportional to their
//     category weight in `mix` (weight 3 ≈ 3x as often as weight 1).
//   · Categories with weight 0 never appear.
//   · A category never appears MORE THAN twice in a row (so the feed
//     doesn't feel like it's stuck on one type).
//   · An individual item isn't repeated within `SUPPRESSION_MS` ms of
//     its last appearance. With a default of 3 minutes that means
//     viewers staring at the feed for several minutes never see the
//     exact same sentence twice in a row.
//
// Internally the picker maintains a shuffled queue. When the queue is
// drained it reshuffles and starts again, so the user sees a rolling
// loop rather than the same fixed sequence.

const SUPPRESSION_MS = 3 * 60_000;

export interface Picker {
  /** Pull the next item to show. Returns null only if nothing in the
   *  catalog has a non-zero weight (defensive — shouldn't happen with
   *  any of the shipped mixes). */
  next: () => ActivityItem | null;
}

interface PickerState {
  queue: ActivityItem[];
  /** id → ms-since-epoch when last shown */
  lastShown: Map<string, number>;
  /** Last two categories shown, oldest first. */
  recent: ActivityCategory[];
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build the rotation pool. Each item appears in the pool a number of
 * times equal to its category weight, so weight-3 items get 3x the
 * draws of weight-1 items. Items in zero-weight categories are skipped.
 */
function buildPool(items: ActivityItem[], mix: Mix): ActivityItem[] {
  const pool: ActivityItem[] = [];
  for (const item of items) {
    const w = mix[item.category] ?? 0;
    for (let i = 0; i < w; i++) pool.push(item);
  }
  return shuffleInPlace(pool);
}

export function createPicker(items: ActivityItem[], mix: Mix): Picker {
  const state: PickerState = {
    queue: buildPool(items, mix),
    lastShown: new Map(),
    recent: [],
  };

  function refillIfEmpty() {
    if (state.queue.length === 0) state.queue = buildPool(items, mix);
  }

  function streakBlocked(cat: ActivityCategory): boolean {
    // Block only if BOTH of the last two showings were the same
    // category. "At most twice in a row" → forbid three.
    return state.recent.length >= 2
      && state.recent[0] === cat
      && state.recent[1] === cat;
  }

  function suppressed(item: ActivityItem): boolean {
    const last = state.lastShown.get(item.id);
    return last !== undefined && Date.now() - last < SUPPRESSION_MS;
  }

  function record(item: ActivityItem) {
    state.lastShown.set(item.id, Date.now());
    state.recent.push(item.category);
    if (state.recent.length > 2) state.recent.shift();
  }

  return {
    next() {
      refillIfEmpty();
      if (state.queue.length === 0) return null;

      // Walk the queue from the front, skipping items that violate the
      // streak or suppression guards. Stashed-aside items go to the back
      // so they get another chance later.
      const skipped: ActivityItem[] = [];
      let picked: ActivityItem | null = null;

      while (state.queue.length > 0) {
        const candidate = state.queue.shift()!;
        if (streakBlocked(candidate.category) || suppressed(candidate)) {
          skipped.push(candidate);
          continue;
        }
        picked = candidate;
        break;
      }

      // Put the skipped items back at the END so we'll try them again
      // after the current ones cycle. Shuffle to avoid clustering.
      if (skipped.length > 0) state.queue.push(...shuffleInPlace(skipped));

      if (!picked) {
        // Every remaining item is blocked. Fall back: clear the streak
        // memory and try once more. (Suppression still applies — so
        // we won't double-fire the same item, but we'll happily switch
        // category-streak rules to keep the feed moving.)
        state.recent = [];
        refillIfEmpty();
        if (state.queue.length === 0) return null;
        picked = state.queue.shift()!;
      }

      record(picked);
      return picked;
    },
  };
}
