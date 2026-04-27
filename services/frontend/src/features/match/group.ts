import type { MatchBundle, WorkerMatchResult } from '@/types';
import { scorePct } from './score';

export interface WorkerGroup {
  origin: string;
  experienceYears: number;
  tier: string;
  languages: string[];
  minVisa?: string;
  avgScore: number;
  count: number;
  representative: WorkerMatchResult;
}

/**
 * Cluster workers by (origin, tier, experience) so the UI shows one row per
 * equivalent group with a count badge instead of repeating near-identical rows.
 */
export function groupWorkers(workers: WorkerMatchResult[]): WorkerGroup[] {
  const map = new Map<string, WorkerMatchResult[]>();
  for (const wm of workers) {
    const key = [
      (wm.worker.origin_country ?? '').toUpperCase(),
      wm.match_tier,
      wm.worker.experience_years ?? 0,
    ].join('|');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(wm);
  }
  const groups: WorkerGroup[] = [];
  for (const members of map.values()) {
    const rep = members[0];
    let minVisa: string | undefined;
    for (const m of members) {
      const v = m.worker.visa_valid_until;
      if (v && (!minVisa || v < minVisa)) minVisa = v;
    }
    const langSets = members.map((m) => new Set(m.worker.languages ?? []));
    const commonLangs = (members[0].worker.languages ?? []).filter((l) =>
      langSets.every((s) => s.has(l))
    );
    groups.push({
      origin: rep.worker.origin_country ?? '',
      experienceYears: rep.worker.experience_years ?? 0,
      tier: rep.match_tier,
      languages: commonLangs,
      minVisa,
      avgScore: Math.round(members.reduce((s, m) => s + m.score, 0) / members.length),
      count: members.length,
      representative: rep,
    });
  }
  const tierOrder = { perfect: 0, good: 1, partial: 2 };
  groups.sort((a, b) =>
    (tierOrder[a.tier as keyof typeof tierOrder] ?? 3) -
    (tierOrder[b.tier as keyof typeof tierOrder] ?? 3) ||
    b.avgScore - a.avgScore
  );
  return groups;
}

export function getBundleWorkers(bundle: MatchBundle): WorkerMatchResult[] {
  return (bundle.line_items ?? []).flatMap((li) => li.workers ?? []);
}

export function bundleAvgScorePct(bundle: MatchBundle): number {
  const ws = getBundleWorkers(bundle);
  if (!ws.length) return 0;
  return scorePct(ws.reduce((s, w) => s + w.score, 0) / ws.length);
}
