// Canonical metadata + sample payloads for every event type the
// notification handler recognises. The admin "test notifications" panel
// reads this file to render the form, and the trigger endpoint uses it
// to fill in sensible defaults when the admin omits fields.
//
// Each entry has:
//   event_type : routing key matched in handlers.js
//   group      : section label for the UI ("Deal lifecycle", "Team", …)
//   channels   : which channels the handler actually uses
//   description: 1-line summary of when the event fires in production
//   payload    : canonical default payload — set every contact field
//                inline so the test send doesn't need org/admin lookups
//   override_keys : payload keys that should be replaced by the admin's
//                test phone/email. Lets the panel safely re-route SMS+email
//                to test targets without touching the rest of the payload.

const TEST_CATALOG = [
  // ─── Org lifecycle ──────────────────────────────────────────────────────
  {
    event_type: 'org.registered',
    group:      'Org lifecycle',
    channels:   ['sms', 'email'],
    description: 'A new contractor or corporation finished /register — fans out to all platform admins.',
    payload: {
      org_name: 'אבני דרך בנייה בע״מ',
      org_type: 'contractor',
    },
    override_keys: [],
    notes: 'Fan-out target is every active admin in auth_db.users. Overrides are ignored — uses real admin recipients.',
  },
  {
    event_type: 'org.approved',
    group:      'Org lifecycle',
    channels:   ['sms', 'email'],
    description: 'Admin clicked Approve on the approvals page. Tells the org owner they’re live.',
    payload: {
      contact_name:   'יוסי כהן',
      contact_phone:  '+972500000000',
      contact_email:  'test@example.com',
      org_name:       'אבני דרך בנייה בע״מ',
      org_type:       'contractor',
    },
    override_keys: ['contact_phone', 'contact_email'],
  },
  {
    event_type: 'org.rejected',
    group:      'Org lifecycle',
    channels:   ['email'],
    description: 'Admin rejected the org from the approvals page.',
    payload: {
      contact_name:  'יוסי כהן',
      contact_email: 'test@example.com',
      org_name:      'אבני דרך בנייה בע״מ',
      org_type:      'contractor',
      reason:        'מסמכים חסרים',
    },
    override_keys: ['contact_email'],
  },
  {
    event_type: 'org.sla.warning',
    group:      'Org lifecycle',
    channels:   ['email'],
    description: 'Org hasn’t been approved within SLA — emails platform admin.',
    payload: {
      org_name:      'אבני דרך בנייה בע״מ',
      org_type:      'corporation',
      hours_pending: 26,
    },
    override_keys: [],
  },

  // ─── Auth / OTP ──────────────────────────────────────────────────────
  {
    event_type: 'contractor.verify.sms_code',
    group:      'Auth',
    channels:   ['sms'],
    description: 'Contractor self-verification OTP (separate from login OTP).',
    payload: {
      contact_phone: '+972500000000',
      contact_name:  'יוסי כהן',
      code:          '123456',
    },
    override_keys: ['contact_phone'],
  },
  {
    event_type: 'contractor.verify.email_link',
    group:      'Auth',
    channels:   ['email'],
    description: 'Contractor self-verification email magic-link.',
    payload: {
      contact_email: 'test@example.com',
      contact_name:  'יוסי כהן',
      verify_url:    'https://app.tagidai.com/verify/abc',
    },
    override_keys: ['contact_email'],
  },
  {
    event_type: 'contractor.verified',
    group:      'Auth',
    channels:   ['sms', 'email'],
    description: 'Auto-verification against פנקס הקבלנים succeeded.',
    payload: {
      contractor_id:     '00000000-0000-0000-0000-000000000000',
      contact_name:      'יוסי כהן',
      contact_phone:     '+972500000000',
      contact_email:     'test@example.com',
      company_name:      'אבני דרך בנייה בע״מ',
    },
    override_keys: ['contact_phone', 'contact_email'],
  },
  {
    event_type: 'contractor.blocked.deleted_company',
    group:      'Auth',
    channels:   ['email'],
    description: 'Contractor’s פנקס הקבלנים row was removed — license deemed invalid.',
    payload: {
      contact_email: 'test@example.com',
      contact_name:  'יוסי כהן',
      company_name:  'אבני דרך בנייה בע״מ',
    },
    override_keys: ['contact_email'],
  },
  {
    event_type: 'contractor.verification.expired',
    group:      'Auth',
    channels:   ['email'],
    description: 'Contractor’s registry verification expired (annual re-check).',
    payload: {
      contact_email: 'test@example.com',
      contact_name:  'יוסי כהן',
    },
    override_keys: ['contact_email'],
  },

  // ─── Deal lifecycle ──────────────────────────────────────────────────────
  {
    event_type: 'deal.proposed',
    group:      'Deal lifecycle',
    channels:   ['sms', 'email'],
    description: 'Contractor created a new request and a corporation can fill it (match found).',
    payload: {
      deal_id:           '00000000-0000-0000-0000-000000000000',
      corporation_id:    '00000000-0000-0000-0000-000000000000',
      corporation_phone: '+972500000000',
      corporation_email: 'test@example.com',
      contractor_name:   'יוסי כהן',
      corp_deal_no:      127,
      profession_he:     'טייחים',
      region_he:         'מרכז',
    },
    override_keys: ['corporation_phone', 'corporation_email'],
    notes: 'Production fan-out targets the corp’s configured recipients. With a fake corporation_id, falls back to corporation_email/corporation_phone — which is exactly where the overrides land. corp_deal_no surfaces in the SMS as "#C-{n}" so the corp team can reference the deal internally.',
  },
  {
    event_type: 'deal.accepted',
    group:      'Deal lifecycle',
    channels:   ['sms', 'email'],
    description: 'Corp accepted the deal. Tells contractor a match has been confirmed.',
    payload: {
      deal_id:           '00000000-0000-0000-0000-000000000000',
      contractor_id:     '00000000-0000-0000-0000-000000000000',
      contractor_phone:  '+972500000000',
      contractor_email:  'test@example.com',
      corporation_name:  'מעלות גיוס',
      profession_he:     'טייחים',
    },
    override_keys: ['contractor_phone', 'contractor_email'],
    notes: 'Production fan-out targets contractor’s configured recipients. With a fake contractor_id, falls back to contractor_email/contractor_phone — overrides land there.',
  },
  {
    event_type: 'deal.corp_committed',
    group:      'Deal lifecycle',
    channels:   ['sms', 'email'],
    description: 'Corp committed a worker list — contractor has 48h to approve.',
    payload: {
      deal_id:                       '00000000-0000-0000-0000-000000000000',
      contractor_contact_name:       'יוסי כהן',
      contractor_contact_phone:      '+972500000000',
      contractor_contact_email:      'test@example.com',
      worker_count:                  4,
      profession_he:                 'טייחים',
      region_he:                     'מרכז',
    },
    override_keys: ['contractor_contact_phone', 'contractor_contact_email'],
  },
  {
    event_type: 'deal.approved',
    group:      'Deal lifecycle',
    channels:   ['sms', 'email'],
    description: 'Contractor approved the list. Sends both sides a confirmation; SMS says when the charge will fire (or that it’s free during launch).',
    payload: {
      contractor_contact_name:  'יוסי כהן',
      contractor_contact_phone: '+972500000000',
      contractor_contact_email: 'test@example.com',
      corp_contact_name:        'דנה לוי',
      corp_contact_email:       'test@example.com',
      contractor_name:          'יוסי כהן',
      corp_name:                'מעלות גיוס',
      worker_count:             4,
      profession_he:            'טייחים',
      commission_amount:        2500,
      scheduled_capture_at:     new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    },
    override_keys: ['contractor_contact_phone', 'contractor_contact_email', 'corp_contact_email'],
  },
  {
    event_type: 'deal.rejected',
    group:      'Deal lifecycle',
    channels:   ['sms', 'email'],
    description: 'Contractor rejected the corp’s committed list (within the 48h window).',
    payload: {
      deal_id:              '00000000-0000-0000-0000-000000000000',
      corp_contact_name:    'דנה לוי',
      corp_contact_phone:   '+972500000000',
      corp_contact_email:   'test@example.com',
      contractor_name:      'יוסי כהן',
      worker_count:         4,
      profession_he:        'טייחים',
      rejection_reason:     'אי-התאמה לדרישות',
    },
    override_keys: ['corp_contact_phone', 'corp_contact_email'],
  },
  {
    event_type: 'deal.expired',
    group:      'Deal lifecycle',
    channels:   ['sms', 'email'],
    description: 'Contractor didn’t approve within 48h — deal auto-expired.',
    payload: {
      deal_id:                       '00000000-0000-0000-0000-000000000000',
      contractor_contact_name:       'יוסי כהן',
      contractor_contact_phone:      '+972500000000',
      contractor_contact_email:      'test@example.com',
      corp_contact_name:             'דנה לוי',
      corp_contact_email:            'test@example.com',
      profession_he:                 'טייחים',
    },
    override_keys: ['contractor_contact_phone', 'contractor_contact_email', 'corp_contact_email'],
  },
  {
    event_type: 'deal.cancelled_by_corp',
    group:      'Deal lifecycle',
    channels:   ['sms', 'email'],
    description: 'Corp cancelled the deal before capture.',
    payload: {
      contractor_contact_name:  'יוסי כהן',
      contractor_contact_phone: '+972500000000',
      contractor_contact_email: 'test@example.com',
      corp_name:                'מעלות גיוס',
      worker_count:             4,
      profession_he:            'טייחים',
    },
    override_keys: ['contractor_contact_phone', 'contractor_contact_email'],
  },
  {
    event_type: 'deal.closed',
    group:      'Deal lifecycle',
    channels:   ['sms', 'email'],
    description: 'Capture succeeded — deal closed, both sides notified.',
    payload: {
      contractor_contact_name:  'יוסי כהן',
      contractor_contact_phone: '+972500000000',
      contractor_contact_email: 'test@example.com',
      corp_contact_name:        'דנה לוי',
      corp_contact_email:       'test@example.com',
      worker_count:             4,
      profession_he:            'טייחים',
    },
    override_keys: ['contractor_contact_phone', 'contractor_contact_email', 'corp_contact_email'],
  },
  {
    event_type: 'deal.discrepancy.flagged',
    group:      'Deal lifecycle',
    channels:   ['email'],
    description: 'Admin or system flagged a discrepancy on a deal — notifies admin.',
    payload: {
      deal_id:    '00000000-0000-0000-0000-000000000000',
      reason:     'Worker count mismatch',
      flagged_by: 'system',
    },
    override_keys: [],
  },
  {
    event_type: 'deal.pending_admin_nudge',
    group:      'Deal lifecycle',
    channels:   ['email'],
    description: 'Pending admin action on a deal for >X hours — daily admin nudge.',
    payload: {
      deal_id:       '00000000-0000-0000-0000-000000000000',
      hours_pending: 26,
    },
    override_keys: [],
  },

  // ─── Search ──────────────────────────────────────────────────────
  {
    event_type: 'search.no_match',
    group:      'Search',
    channels:   ['sms'],
    description: 'Contractor’s search found zero matching corps with workers — pings every active corp as a recruiting nudge.',
    payload: {
      profession_he: 'טייחים',
      region_he:     'מרכז',
      qty:           5,
      recruitment:   'מקומי',
    },
    override_keys: [],
    notes: 'Fan-out target is every active corp from user-org. Overrides ignored.',
  },

  // ─── Worker ──────────────────────────────────────────────────────
  {
    event_type: 'worker.changed',
    group:      'Worker',
    channels:   [],
    description: 'A worker was added or status changed — re-runs the match for open searches. Internal effect, no message body.',
    payload: { worker_id: '00000000-0000-0000-0000-000000000000' },
    override_keys: [],
  },
  {
    event_type: 'worker_search.changed',
    group:      'Worker',
    channels:   [],
    description: 'A WorkerSearch was edited — re-runs the match. Internal effect, no message body.',
    payload: { search_id: '00000000-0000-0000-0000-000000000000' },
    override_keys: [],
  },
  {
    event_type: 'worker.visa.expired',
    group:      'Worker',
    channels:   ['email'],
    description: 'Worker visa expired — emails the corp.',
    payload: {
      corp_contact_email: 'test@example.com',
      worker_name:        'János Kovács',
      visa_expired_on:    '2026-06-01',
    },
    override_keys: ['corp_contact_email'],
  },

  // ─── Team / membership ──────────────────────────────────────────────
  {
    event_type: 'team.invited',
    group:      'Team',
    channels:   ['sms'],
    description: 'Team member invited to join an org.',
    payload: {
      invited_phone:  '+972500000000',
      inviter_name:   'יוסי כהן',
      entity_name:    'אבני דרך בנייה בע״מ',
      role_label:     'מנהל',
      accept_url:     'https://app.tagidai.com/invite/abc',
    },
    override_keys: ['invited_phone'],
  },
  {
    event_type: 'team.membership_request.created',
    group:      'Team',
    channels:   ['sms'],
    description: 'Existing user asked to join an org — pings the owner.',
    payload: {
      owner_phone:      '+972500000000',
      owner_name:       'יוסי כהן',
      requester_name:   'דנה לוי',
      requester_phone:  '+972500000000',
      entity_kind:      'corporation',
      entity_name:      'מעלות גיוס',
      accept_url:       'https://app.tagidai.com/membership-request/accept/abc',
    },
    override_keys: ['owner_phone'],
  },
  {
    event_type: 'team.membership_request.approved',
    group:      'Team',
    channels:   ['sms'],
    description: 'Owner approved the membership request.',
    payload: {
      requester_phone: '+972500000000',
      requester_name:  'דנה לוי',
      entity_kind:     'corporation',
      login_url:       'https://app.tagidai.com/login',
    },
    override_keys: ['requester_phone'],
  },
  {
    event_type: 'team.membership_request.rejected',
    group:      'Team',
    channels:   ['sms'],
    description: 'Owner rejected the membership request.',
    payload: {
      requester_phone: '+972500000000',
      requester_name:  'דנה לוי',
      entity_kind:     'corporation',
    },
    override_keys: ['requester_phone'],
  },

  // ─── Tender ──────────────────────────────────────────────────────
  {
    event_type: 'tender.published',
    group:      'Tender',
    channels:   ['sms'],
    description: 'New foreign-import tender broadcast to all tier-2 corps.',
    payload: {
      tender_id:      '00000000-0000-0000-0000-000000000000',
      total_quantity: 12,
      professions:    [{ code: 'plasterer', name_he: 'טייחים' }],
    },
    override_keys: [],
    notes: 'Fan-out target is every active tier-2 corp. Overrides ignored.',
  },
  {
    event_type: 'tender.bid_submitted',
    group:      'Tender',
    channels:   ['sms'],
    description: 'Corp bid on a tender — contractor pinged.',
    payload: {
      contractor_id:     '00000000-0000-0000-0000-000000000000',
      tender_id:         '00000000-0000-0000-0000-000000000000',
    },
    override_keys: [],
    notes: 'Phone is looked up from contractor_id via user-org.',
  },
  {
    event_type: 'tender.revealed',
    group:      'Tender',
    channels:   ['sms'],
    description: 'Admin approved tender — corp identity revealed to both sides.',
    payload: {
      tender_id:               '00000000-0000-0000-0000-000000000000',
      contractor_contact_phone:'+972500000000',
      corp_contact_phone:      '+972500000000',
    },
    override_keys: ['contractor_contact_phone', 'corp_contact_phone'],
  },

  // ─── Other ──────────────────────────────────────────────────────
  {
    event_type: 'message.new',
    group:      'Other',
    channels:   ['sms', 'email'],
    description: 'A new in-deal chat message — pings the recipient side.',
    payload: {
      deal_id:           '00000000-0000-0000-0000-000000000000',
      recipient_phone:   '+972500000000',
      recipient_email:   'test@example.com',
      sender_label:      'הקבלן',
    },
    override_keys: ['recipient_phone', 'recipient_email'],
    notes: 'In production the deal-service attaches contractor_id/corporation_id and the recipient is picked from the org’s configured recipients. With those omitted, falls back to recipient_email/recipient_phone — overrides land there.',
  },
  {
    event_type: 'commission.invoiced',
    group:      'Other',
    channels:   ['email'],
    description: 'Commission invoice issued — emails the contractor.',
    payload: {
      contact_email:    'test@example.com',
      contact_name:     'יוסי כהן',
      invoice_number:   '2026-001',
      invoice_url:      'https://cardcom.example.com/invoice/abc',
      amount:           2500,
    },
    override_keys: ['contact_email'],
  },
];

// List of cron jobs the panel can fire manually. The handler name maps to
// the require path so the trigger endpoint can resolve it without a switch.
const TEST_CRONS = [
  {
    name:        'visaExpiry',
    description: 'Sweep workers whose visas expire in 30 / 7 / 0 days. Daily 06:00 in prod.',
    module:      '../cron/visaExpiry',
    fn:          'runVisaExpiryCron',
  },
  {
    name:        'contractorRevalidation',
    description: 'Re-checks tier_2 contractors against פנקס הקבלנים. Daily 06:30 in prod.',
    module:      '../cron/contractorRevalidation',
    fn:          'runContractorRevalidationCron',
  },
  {
    name:        'dealLifecycle',
    description: 'Sweep deals — expire / capture / nudge. Hourly in prod.',
    module:      '../cron/dealLifecycle',
    fn:          'runDealLifecycleCron',
  },
  {
    name:        'contractorApprovalReminder',
    description: 'SMS contractors with stuck corp_committed deals (>24h pending approval). Daily 09:00 in prod.',
    module:      '../cron/contractorApprovalReminder',
    fn:          'runContractorApprovalReminderCron',
  },
  {
    name:        'corpResponseOverdue',
    description: 'Admin alert for `proposed` deals past the corp-response deadline. Every 5 min in prod.',
    module:      '../cron/corpResponseOverdue',
    fn:          'runCorpResponseOverdueCron',
  },
];

module.exports = { TEST_CATALOG, TEST_CRONS };
