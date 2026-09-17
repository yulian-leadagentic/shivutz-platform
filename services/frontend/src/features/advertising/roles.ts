// U7 · R2 · single source of truth for the three self-registration
// paths on the public landing. RoleRegisterPicker and
// RegistrationCTASection both consume this so provider never gets
// dropped from one component while the other renders it — the exact
// regression cc_run_sheet_0917.md called out at R2.

export type RoleId = 'contractor' | 'corporation' | 'service_provider';

export interface Role {
  id:    RoleId;
  title: string;
  href:  string;
}

export const ROLES: readonly Role[] = [
  { id: 'contractor',       title: 'קבלן',              href: '/register/contractor' },
  { id: 'corporation',      title: 'תאגיד כוח אדם',      href: '/register/corporation' },
  { id: 'service_provider', title: 'ספק שירותים נלווים', href: '/register/provider' },
] as const;
