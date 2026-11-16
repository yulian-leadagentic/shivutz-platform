import { apiFetch } from './client';

// R38 · the entity a user's phone speaks for on WhatsApp
// (user-org routes/users.py). One active membership needs no choice;
// with several, the chat searches as the one chosen here.

export interface WhatsAppMembership {
  membership_id: string;
  entity_type:   'contractor' | 'corporation' | 'service_provider';
  entity_id:     string;
  entity_name:   string | null;
  role:          string | null;
}

export interface WhatsAppEntityState {
  user_id:                 string;
  memberships:             WhatsAppMembership[];
  default_membership_id:   string | null;
  effective_membership_id: string | null;
  choice_needed:           boolean;
}

const put = (membershipId: string | null): RequestInit => ({
  method: 'PUT',
  body:   JSON.stringify({ membership_id: membershipId }),
});

export const whatsappEntityApi = {
  mine:    () => apiFetch<WhatsAppEntityState>('/users/me/whatsapp-entity'),
  setMine: (membershipId: string | null) =>
    apiFetch<WhatsAppEntityState>('/users/me/whatsapp-entity', put(membershipId)),

  /** Platform admin only. */
  ofUser: (userId: string) =>
    apiFetch<WhatsAppEntityState>(`/users/${encodeURIComponent(userId)}/whatsapp-entity`),
  setForUser: (userId: string, membershipId: string | null) =>
    apiFetch<WhatsAppEntityState>(`/users/${encodeURIComponent(userId)}/whatsapp-entity`, put(membershipId)),
};
