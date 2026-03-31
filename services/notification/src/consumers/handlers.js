const axios = require('axios') || require('node:https');

const USER_ORG_URL = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL || 'admin@shivutz-platform.co.il';

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

    default:
      console.warn(`[handlers] No handler for: ${routingKey}`);
  }
}

module.exports = { handle };
