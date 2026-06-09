// Wave 3 — searchApi replaces jobApi. The project + line-items model
// was collapsed into self-contained worker_searches.
import { apiFetch } from './client';
import { orgApi } from './organizations';
import type {
  CorpMatch,
  WorkerSearch,
  WorkerSearchCreate,
  WorkerSearchUpdate,
} from '@/types';

// Public-browse row shape for /searches/open — the contractor identity
// is replaced by an anonymous label so corps can browse without seeing
// who's behind the request until they engage.
export interface OpenSearchRow {
  id: string;
  anon_label: string;            // "קבלן N"
  recruitment_type: string;
  region: string;
  profession_type: string;
  quantity: number;
  start_date: string;
  end_date: string;
  origin_preference: string[];
  status: string;
  created_at: string;
  /** R5 #6 — corps that already moved a deal to corp_committed or
   *  later for this search. Stops counting at 'closed'. */
  committed_corp_count: number;
  /** Sum of workers attached across the corps in
   *  `committed_corp_count`. */
  committed_worker_sum: number;
  /** True when 3+ corps have already committed AND the sum of their
   *  committed workers >= the requested quantity. The 3-corp cap from
   *  product: late corps are locked out so the contractor doesn't
   *  juggle 5+ identical proposals. Backend enforces the rule on
   *  POST /deals/{id}/commit; UI surfaces the lock visually. */
  search_locked: boolean;
}

export const searchApi = {
  list: () => apiFetch<WorkerSearch[]>('/searches'),

  /** Corp-facing browse — every active worker_search across all
   *  contractors, with the contractor identity anonymized. */
  listOpen: () => apiFetch<OpenSearchRow[]>('/searches/open'),

  get: (id: string) => apiFetch<WorkerSearch>(`/searches/${id}`),

  create: (data: WorkerSearchCreate) =>
    apiFetch<{ id: string; status: string }>('/searches', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: WorkerSearchUpdate) =>
    apiFetch<{ id: string }>(`/searches/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  cancel: (id: string) =>
    apiFetch<{ id: string; status: string }>(`/searches/${id}`, {
      method: 'DELETE',
    }),

  /** Run the matcher and return sorted CorpMatch entries with corp names hydrated. */
  match: async (id: string): Promise<CorpMatch[]> => {
    const res = await apiFetch<{ corps: CorpMatch[] }>(`/searches/${id}/match`, {
      method: 'POST',
    });
    const corps = res.corps ?? [];
    await Promise.allSettled(
      corps.map(async (c) => {
        try {
          const corp = await orgApi.getCorporation(c.corporation_id);
          c.corporation_name = corp.company_name_he || corp.company_name;
          c.threshold_requirements = corp.threshold_requirements ?? null;
        } catch {
          c.corporation_name = c.corporation_id;
        }
      })
    );
    return corps;
  },

  /** Read cached matcher output without re-running. */
  matchResults: async (id: string): Promise<CorpMatch[] | null> => {
    try {
      const res = await apiFetch<{ corps: CorpMatch[] }>(`/searches/${id}/match-results`);
      return res.corps ?? [];
    } catch {
      return null;
    }
  },
};

// Legacy alias kept for one release so any pages still importing
// `jobApi` don't blow up at runtime. New code uses searchApi.
export const jobApi = searchApi;
