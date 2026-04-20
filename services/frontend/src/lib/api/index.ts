// Barrel — preserves `@/lib/api` imports after the split.
// Prefer importing from the specific module (e.g. `@/lib/api/jobs`) in new code.

export { apiFetch, BASE } from './client';

export { authApi, otpApi, inviteApi } from './auth';
export type { Membership, InviteMetadata } from './auth';

export { enumApi } from './enums';
export { orgApi } from './organizations';
export { jobApi } from './jobs';
export { workerApi } from './workers';
export { dealApi } from './deals';

export { memberApi } from './members';
export type { TeamMember } from './members';

export { documentApi, DOC_TYPE_LABELS } from './documents';
export type { OrgDocument } from './documents';

export { paymentApi } from './payments';
export { marketplaceApi, leadsApi } from './marketplace';
