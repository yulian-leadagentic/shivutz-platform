const USER_ORG_URL   = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || 'admin@shivutz-platform.co.il';
const NOTIF_URL      = `http://localhost:${process.env.PORT || 3006}`;
const FRONTEND_URL   = process.env.FRONTEND_URL || 'https://app.shivutz.co.il';

const ROLE_LABELS_HE = {
  owner:    'בעלים',
  admin:    'מנהל',
  operator: 'מפעיל',
  viewer:   'צופה',
};

async function sendSmsInternal(phone, message) {
  try {
    const resp = await fetch(`${NOTIF_URL}/internal/sms`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone, message }),
    });
    if (!resp.ok) console.error('[handlers] SMS failed:', await resp.text());
  } catch (err) {
    console.error('[handlers] SMS unreachable:', err.message);
  }
}

/**
 * Route each event to the appropriate recipient + template.
 * sendEmail(eventKey, recipientEmail, recipientUserId, variables)
 */
async function handle(routingKey, payload, sendEmail) {
  switch (routingKey) {
    case 'org.registered':
      await sendEmail('org.registered', ADMIN_EMAIL, null, {
        org_name: payload.org_name,
      });
      break;

    case 'org.approved':
      await sendEmail('org.approved', payload.contact_email, null, {
        contact_name: payload.contact_name,
        org_name:     payload.org_name,
      });
      // Send SMS with direct link — contractors get link to create worker request
      if (payload.contact_phone) {
        const link = payload.org_type === 'contractor'
          ? `${FRONTEND_URL}/contractor/requests/new`
          : `${FRONTEND_URL}/corporation/dashboard`;
        const firstName = (payload.contact_name || '').split(' ')[0] || 'שלום';
        await sendSmsInternal(
          payload.contact_phone,
          `${firstName}, החשבון שלך בפלטפורמת שיבוץ אושר ✓\n${payload.org_type === 'contractor' ? 'לפתיחת בקשה לעובדים: ' : 'כניסה לחשבון: '}${link}`
        );
      }
      break;

    case 'org.rejected':
      await sendEmail('org.rejected', payload.contact_email, null, {
        contact_name: payload.contact_name,
        reason:       payload.reason || 'לא צוינה סיבה',
      });
      break;

    case 'org.sla.warning':
      await sendEmail('org.sla.warning', ADMIN_EMAIL, null, {
        org_name: payload.org_name,
        hours:    payload.hours || 40,
      });
      break;

    case 'deal.proposed':
      // Notify the corporation
      await sendEmail('deal.proposed', payload.corporation_email || ADMIN_EMAIL, null, {
        contractor_name: payload.contractor_name || payload.contractor_id,
        project_name:    payload.project_name || 'פרויקט חדש',
        deal_id:         payload.deal_id,
      });
      break;

    case 'deal.accepted':
      await sendEmail('deal.accepted', payload.contractor_email || ADMIN_EMAIL, null, {
        corporation_name: payload.corporation_name || payload.corporation_id,
        project_name:     payload.project_name || '',
        deal_id:          payload.deal_id,
      });
      break;

    case 'deal.discrepancy.flagged':
      await sendEmail('deal.discrepancy.flagged', ADMIN_EMAIL, null, {
        deal_id: payload.deal_id,
      });
      break;

    case 'message.new':
      await sendEmail('message.new', payload.recipient_email || ADMIN_EMAIL, null, {
        deal_id:     payload.deal_id,
        sender_name: payload.sender_role || 'משתמש',
      });
      break;

    case 'commission.invoiced':
      await sendEmail('commission.invoiced', ADMIN_EMAIL, null, {
        invoice_number: payload.commission_id,
        deal_id:        payload.deal_id,
      });
      break;

    case 'worker.visa.expiring_30d':
    case 'worker.visa.expiring_7d':
      await sendEmail('worker.visa.expiring_30d', payload.corporation_email || ADMIN_EMAIL, null, {
        worker_name: payload.worker_name || 'עובד',
        visa_date:   payload.visa_date || '',
      });
      break;

    case 'worker.visa.expired':
      await sendEmail('worker.visa.expired', payload.corporation_email || ADMIN_EMAIL, null, {
        worker_name: payload.worker_name || 'עובד',
      });
      break;

    case 'team.invited': {
      const roleLabel   = ROLE_LABELS_HE[payload.role] ?? payload.role;
      const inviteUrl   = `${FRONTEND_URL}/invite/accept/${payload.invite_token}`;
      const inviterName = payload.inviter_name || 'המנהל';
      const entityName  = payload.entity_name  || 'הארגון';
      const message     = `שלום! ${inviterName} מזמין אותך להצטרף לצוות "${entityName}" בפלטפורמת שיבוץ בתפקיד ${roleLabel}.\nלהתחברות והצטרפות לפלטפורמה:\n${inviteUrl}`;
      await sendSmsInternal(payload.phone, message);
      break;
    }

    default:
      console.warn(`[handlers] No handler for: ${routingKey}`);
  }
}

module.exports = { handle };
