import { apiFetch } from './client';

export interface SupportTicketCreate {
  subject: string;
  body: string;
  contact_phone?: string;
}

export const supportApi = {
  /** Submit a "פניה לשירות לקוחות" ticket. Any authenticated user can call. */
  submit: (data: SupportTicketCreate) =>
    apiFetch<{ id: string; status: 'open' }>('/support-tickets', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
