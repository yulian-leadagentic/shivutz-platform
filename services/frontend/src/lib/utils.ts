import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Render a deal/search UUID as a friendly 6-digit reference number
 * for display. We take the first 6 hex chars of the UUID, interpret
 * as decimal, modulo 1,000,000, zero-padded. Deterministic — the
 * same UUID always renders to the same number — but only ~17 bits
 * of entropy so collisions in a global view are possible.
 *
 * Use for human-friendly identifiers in UI labels. The real UUID
 * still travels in URLs and API payloads.
 */
export function dealRef(uuid: string | null | undefined): string {
  if (!uuid) return '------';
  const hex = uuid.replace(/-/g, '').slice(0, 6);
  const n = parseInt(hex, 16);
  if (isNaN(n)) return '------';
  return String(n % 1000000).padStart(6, '0');
}
