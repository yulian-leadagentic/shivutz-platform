// R5 §2b · provider listing creation. Re-exports the same form the
// corporation route uses — the form already reads entityType via
// useAuth so it filters/defaults correctly for providers. Kept as a
// separate route so the /provider/* RoleGuard applies and a corp can't
// reach a provider-scoped URL just by typing it.
export { default } from '@/app/corporation/marketplace/new/page';
