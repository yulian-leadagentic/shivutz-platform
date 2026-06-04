// Per-user notification opt-in API.
//
// Backend endpoints (user-org):
//   GET  /organizations/{type}/{id}/notification-recipients
//   PUT  /organizations/{type}/{id}/notification-recipients/{user_id}
//
// `type` = 'corporations' or 'contractors' (the URL form is plural to
// match the rest of the user-org REST surface).

import { apiFetch } from './client';

export type NotificationChannel = 'email' | 'sms' | 'whatsapp';

export interface RecipientRow {
  user_id:         string;
  full_name:       string;
  phone:           string | null;
  email:           string | null;
  membership_role: 'owner' | 'admin' | 'viewer' | string | null;
  is_recipient:    boolean;
  channels:        NotificationChannel[];
  updated_at?:     string | null;
}

export interface RecipientUpsertBody {
  is_active: boolean;
  channels:  NotificationChannel[];
}

export const notificationRecipientsApi = {
  list: (entityType: 'corporation' | 'contractor', entityId: string) => {
    const plural = entityType === 'corporation' ? 'corporations' : 'contractors';
    return apiFetch<RecipientRow[]>(`/organizations/${plural}/${entityId}/notification-recipients`);
  },
  upsert: (
    entityType: 'corporation' | 'contractor',
    entityId: string,
    userId: string,
    body: RecipientUpsertBody,
  ) => {
    const plural = entityType === 'corporation' ? 'corporations' : 'contractors';
    return apiFetch<{ user_id: string; is_active: boolean; channels: NotificationChannel[] }>(
      `/organizations/${plural}/${entityId}/notification-recipients/${userId}`,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  },
};
