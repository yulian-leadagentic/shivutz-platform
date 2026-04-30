const USER_ORG_URL   = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';
const JOB_MATCH_URL  = process.env.JOB_MATCH_SERVICE_URL || 'http://job-match:3004';
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

// ── Match-found helpers ─────────────────────────────────────────────────
//
// matchInternalResult shape (from job-match's /internal endpoints):
//   {
//     request_id, should_notify, skipped,
//     contractor_id, contact_name, contact_phone, contact_email,
//     project_name, project_name_he, region, worker_count, best_fill_pct
//   }
//
// We send SMS + email for every entry where should_notify=true. Skipped
// entries (debounced) are silently ignored.

async function notifyMatchFound(result, sendEmail) {
  if (!result || !result.should_notify) return;

  const matchUrl  = `${FRONTEND_URL}/contractor/requests/${result.request_id}/match`;
  const project   = result.project_name_he || result.project_name || 'הבקשה שלך';
  const firstName = (result.contact_name || '').split(' ')[0] || 'שלום';

  if (result.contact_phone) {
    await sendSmsInternal(
      result.contact_phone,
      `שיבוץ — ${firstName}, נמצאה התאמה מלאה ל"${project}" (${result.worker_count || 0} עובדים). ` +
      `לצפייה בהצעה: ${matchUrl}`
    );
  }

  if (result.contact_email) {
    await sendEmail('match.found', result.contact_email, result.contractor_id || null, {
      contact_name:    result.contact_name || '',
      project_name:    project,
      worker_count:    result.worker_count || 0,
      region:          result.region || '',
      match_url:       matchUrl,
    });
  }
}

async function rematchForCorp(corporationId, professionType) {
  if (!professionType) return [];
  try {
    const resp = await fetch(`${JOB_MATCH_URL}/internal/rematch-for-corp`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ corporation_id: corporationId, profession_type: professionType }),
    });
    if (!resp.ok) {
      console.error('[rematch-corp] non-2xx:', resp.status, await resp.text());
      return [];
    }
    const json = await resp.json();
    return json.results || [];
  } catch (err) {
    console.error('[rematch-corp] unreachable:', err.message);
    return [];
  }
}

async function rematchForRequest(requestId, force) {
  try {
    const resp = await fetch(`${JOB_MATCH_URL}/internal/rematch-for-request`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ request_id: requestId, force: !!force }),
    });
    if (!resp.ok) {
      console.error('[rematch-request] non-2xx:', resp.status, await resp.text());
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.error('[rematch-request] unreachable:', err.message);
    return null;
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

    case 'contractor.verify.email_link':
      await sendEmail('contractor.verify.email_link', payload.recipient_email, null, {
        contact_name:       payload.contact_name || '',
        magic_link:         payload.magic_link,
        expires_in_minutes: payload.expires_in_minutes || 30,
      });
      break;

    case 'contractor.verify.sms_code': {
      const firstName = (payload.contact_name || '').split(' ')[0] || 'שלום';
      const message =
        `שיבוץ — קוד אימות בעלות לעסק שלך: ${payload.code}\n` +
        `הזן את הקוד באתר כדי להשלים את הרישום. תקף ל-30 דקות.\n` +
        `אם לא ביקשת — התעלם מההודעה (${firstName}).`;
      await sendSmsInternal(payload.phone, message);
      break;
    }

    case 'contractor.blocked.deleted_company':
      await sendEmail('contractor.blocked.deleted_company', ADMIN_EMAIL, null, {
        business_number: payload.business_number,
        company_status:  payload.company_status || '',
        contact_name:    payload.contact_name   || '',
        contact_phone:   payload.contact_phone  || '',
        attempted_at:    payload.attempted_at   || '',
      });
      break;

    case 'contractor.verification.expired':
      if (payload.contact_email) {
        await sendEmail('contractor.verification.expired', payload.contact_email, null, {
          contact_name: payload.contact_name || '',
          company_name: payload.company_name || '',
        });
      }
      if (payload.contact_phone) {
        const firstName = (payload.contact_name || '').split(' ')[0] || 'שלום';
        await sendSmsInternal(
          payload.contact_phone,
          `שיבוץ — ${firstName}, הרישום של ${payload.company_name || 'העסק שלך'} כבר לא מופיע בפנקס הקבלנים. ` +
          `הגשת בקשות לתאגידים מושהית עד שנעדכן את האימות. היכנס לאתר ובחר "אמת מחדש" בהגדרות.`
        );
      }
      break;

    case 'contractor.verified': {
      const methodHe =
        payload.verification_method === 'email'  ? 'קישור אימות במייל' :
        payload.verification_method === 'sms'    ? 'קוד SMS' :
        payload.verification_method === 'manual' ? 'אישור מנהל המערכת' :
        'אימות';
      if (payload.contact_email) {
        await sendEmail('contractor.verified', payload.contact_email, null, {
          contact_name:          payload.contact_name || '',
          company_name:          payload.company_name || '',
          verification_method_he: methodHe,
          dashboard_url:         `${FRONTEND_URL}/contractor/dashboard`,
        });
      }
      if (payload.contact_phone) {
        const firstName = (payload.contact_name || '').split(' ')[0] || 'שלום';
        await sendSmsInternal(
          payload.contact_phone,
          `שיבוץ — ${firstName}, החשבון שלך אומת בהצלחה ✓ אתה יכול עכשיו להגיש בקשות לתאגידים. ` +
          `כניסה: ${FRONTEND_URL}/contractor/dashboard`
        );
      }
      break;
    }

    // ── Deal lifecycle ────────────────────────────────────────────────────

    case 'deal.corp_committed': {
      const dealUrl = `${FRONTEND_URL}/contractor/deals/${payload.deal_id}`;
      const vars = {
        contact_name:    payload.contractor_contact_name || '',
        worker_count:    payload.worker_count || 0,
        profession_he:   payload.profession_he || 'עובדים',
        region_he:       payload.region_he || '',
        deal_url:        dealUrl,
      };
      if (payload.contractor_contact_email) {
        await sendEmail('deal.corp_committed.contractor', payload.contractor_contact_email, null, vars);
      }
      if (payload.contractor_contact_phone) {
        const firstName = (payload.contractor_contact_name || '').split(' ')[0] || 'שלום';
        await sendSmsInternal(
          payload.contractor_contact_phone,
          `שיבוץ — ${firstName}, תאגיד הציע ${vars.worker_count} עובדי ${vars.profession_he} לבקשתך. ` +
          `יש לך 7 ימים לאשר. כניסה: ${dealUrl}`
        );
      }
      break;
    }

    case 'deal.approved': {
      const captureFmt = payload.scheduled_capture_at
        ? new Date(payload.scheduled_capture_at).toLocaleString('he-IL')
        : '';
      // Contractor side
      if (payload.contractor_contact_email) {
        await sendEmail('deal.approved.contractor', payload.contractor_contact_email, null, {
          contact_name:      payload.contractor_contact_name || '',
          worker_count:      payload.worker_count || 0,
          profession_he:     payload.profession_he || 'עובדים',
          corp_name:         payload.corp_name || 'התאגיד',
          commission_amount: payload.commission_amount || 0,
          capture_at:        captureFmt,
        });
      }
      // Corp side
      if (payload.corp_contact_email) {
        await sendEmail('deal.approved.corp', payload.corp_contact_email, null, {
          contact_name:    payload.corp_contact_name || '',
          contractor_name: payload.contractor_name || 'הקבלן',
          worker_count:    payload.worker_count || 0,
          profession_he:   payload.profession_he || 'עובדים',
          capture_at:      captureFmt,
        });
      }
      // Contractor SMS confirmation
      if (payload.contractor_contact_phone) {
        const firstName = (payload.contractor_contact_name || '').split(' ')[0] || 'שלום';
        await sendSmsInternal(
          payload.contractor_contact_phone,
          `שיבוץ — ${firstName}, אישרת רשימה של ${payload.worker_count} עובדים. ` +
          `חיוב יבוצע ב-${captureFmt} (אלא אם התאגיד יבטל בחלון הזמן).`
        );
      }
      break;
    }

    case 'deal.rejected': {
      if (payload.corp_contact_email) {
        await sendEmail('deal.rejected.corp', payload.corp_contact_email, null, {
          contact_name:  payload.corp_contact_name || '',
          worker_count:  payload.worker_count || 0,
          profession_he: payload.profession_he || 'עובדים',
        });
      }
      await sendEmail('deal.rejected.admin', ADMIN_EMAIL, null, {
        contractor_name:   payload.contractor_name || '',
        corp_name:         payload.corp_name || '',
        worker_count:      payload.worker_count || 0,
        profession_he:     payload.profession_he || 'עובדים',
        region_he:         payload.region_he || '',
        commission_amount: payload.commission_amount || 0,
        rejected_at:       payload.rejected_at
          ? new Date(payload.rejected_at).toLocaleString('he-IL') : '',
      });
      break;
    }

    case 'deal.expired': {
      if (payload.contractor_contact_email) {
        await sendEmail('deal.expired.contractor', payload.contractor_contact_email, null, {
          contact_name:  payload.contractor_contact_name || '',
          worker_count:  payload.worker_count || 0,
          profession_he: payload.profession_he || 'עובדים',
        });
      }
      if (payload.corp_contact_email) {
        await sendEmail('deal.expired.corp', payload.corp_contact_email, null, {
          worker_count: payload.worker_count || 0,
        });
      }
      await sendEmail('deal.expired.admin', ADMIN_EMAIL, null, {
        contractor_name:   payload.contractor_name || '',
        corp_name:         payload.corp_name || '',
        worker_count:      payload.worker_count || 0,
        profession_he:     payload.profession_he || 'עובדים',
        commission_amount: payload.commission_amount || 0,
      });
      break;
    }

    case 'deal.cancelled_by_corp': {
      if (payload.contractor_contact_email) {
        await sendEmail('deal.cancelled_by_corp.contractor', payload.contractor_contact_email, null, {
          contact_name:        payload.contractor_contact_name || '',
          corp_name:           payload.corp_name || 'התאגיד',
          cancellation_reason: payload.cancellation_reason || '',
        });
      }
      if (payload.contractor_contact_phone) {
        const firstName = (payload.contractor_contact_name || '').split(' ')[0] || 'שלום';
        await sendSmsInternal(
          payload.contractor_contact_phone,
          `שיבוץ — ${firstName}, ${payload.corp_name || 'התאגיד'} ביטל את העסקה לפני החיוב. לא חויבת. ` +
          `הבקשה שלך נשארת פתוחה.`
        );
      }
      await sendEmail('deal.cancelled_by_corp.admin', ADMIN_EMAIL, null, {
        contractor_name:     payload.contractor_name || '',
        corp_name:           payload.corp_name || '',
        worker_count:        payload.worker_count || 0,
        profession_he:       payload.profession_he || 'עובדים',
        region_he:           payload.region_he || '',
        commission_amount:   payload.commission_amount || 0,
        cancellation_reason: payload.cancellation_reason || '—',
        cancelled_at:        payload.cancelled_at
          ? new Date(payload.cancelled_at).toLocaleString('he-IL') : '',
      });
      break;
    }

    case 'deal.closed': {
      if (payload.contractor_contact_email) {
        await sendEmail('deal.closed.contractor', payload.contractor_contact_email, null, {
          contact_name:      payload.contractor_contact_name || '',
          corp_name:         payload.corp_name || 'התאגיד',
          worker_count:      payload.worker_count || 0,
          profession_he:     payload.profession_he || 'עובדים',
          invoice_number:    payload.invoice_number || (payload.deal_id_short || ''),
          commission_amount: payload.commission_amount || 0,
          invoice_url:       payload.invoice_url || '',
          deal_id_short:     payload.deal_id_short || '',
        });
      }
      if (payload.corp_contact_email) {
        await sendEmail('deal.closed.corp', payload.corp_contact_email, null, {
          contact_name:    payload.corp_contact_name || '',
          contractor_name: payload.contractor_name || 'הקבלן',
          worker_count:    payload.worker_count || 0,
          profession_he:   payload.profession_he || 'עובדים',
        });
      }
      break;
    }

    case 'deal.pending_admin_nudge': {
      await sendEmail('deal.pending_admin_nudge', ADMIN_EMAIL, null, {
        contractor_name:   payload.contractor_name || '',
        corp_name:         payload.corp_name || '',
        worker_count:      payload.worker_count || 0,
        profession_he:     payload.profession_he || 'עובדים',
        region_he:         payload.region_he || '',
        commission_amount: payload.commission_amount || 0,
        hours_pending:     payload.hours_pending || 0,
        expires_at:        payload.expires_at
          ? new Date(payload.expires_at).toLocaleString('he-IL') : '',
      });
      break;
    }

    // ── Match-found notification flow ───────────────────────────────────

    case 'worker.changed': {
      // Corp added/edited/deactivated a worker. Re-match every open
      // request whose line items include that profession. job-match
      // applies the 5-min per-request debounce internally.
      const results = await rematchForCorp(payload.corporation_id, payload.profession_type);
      for (const r of results) {
        await notifyMatchFound(r, sendEmail);
      }
      break;
    }

    case 'job_request.changed': {
      // Contractor created/edited their own request. Re-match just this
      // one, force=true to bypass the debounce (the contractor's edit
      // should be reflected immediately).
      const result = await rematchForRequest(payload.request_id, true);
      await notifyMatchFound(result, sendEmail);
      break;
    }

    default:
      console.warn(`[handlers] No handler for: ${routingKey}`);
  }
}

module.exports = { handle };
