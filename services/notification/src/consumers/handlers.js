const USER_ORG_URL   = process.env.USER_ORG_SERVICE_URL || 'http://user-org:3002';
const JOB_MATCH_URL  = process.env.JOB_MATCH_SERVICE_URL || 'http://job-match:3004';
const DEAL_URL       = process.env.DEAL_SERVICE_URL     || 'http://deal:3005';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL || 'admin@shivutz-platform.co.il';
const NOTIF_URL      = `http://localhost:${process.env.PORT || 3006}`;
const FRONTEND_URL   = process.env.FRONTEND_URL || 'https://app.shivutz.co.il';

// FREE_LAUNCH_UNTIL=YYYY-MM-DD (or full ISO) — when the date is still in the
// future, the contractor-approved SMS drops the "חיוב יבוצע ב-…" sentence
// since the payment service is short-circuiting captures anyway. Mirrors the
// gate in services/payment/app/services/cardcom.py so both sides stay in
// lockstep.
const FREE_LAUNCH_UNTIL = (process.env.FREE_LAUNCH_UNTIL || '').trim() || null;

function isFreeLaunchActive() {
  if (!FREE_LAUNCH_UNTIL) return false;
  const cutoff = new Date(FREE_LAUNCH_UNTIL);
  if (isNaN(cutoff.getTime())) {
    return false;
  }
  return new Date() < cutoff;
}

// Phase-1 fan-out helper — picks up every team member the org flagged
// as a notification recipient and dispatches per their channel choices.
const { notifyEntity } = require('../dispatch/notifyEntity');

// 'operator' was dropped Wave 2 (2026-05) — kept in the legacy fallback
// case `payload.role` for any in-flight events from older deploys.
const ROLE_LABELS_HE = {
  owner:    'בעלים',
  admin:    'מנהל',
  viewer:   'צופה',
};

// E.164 normaliser for Israeli mobile numbers. Required because some
// publishers (team.invited, deal.* fan-out, etc.) pass through whatever
// the user typed at invite-time. Vonage rejects local-format (0XX...)
// with DLR error code 12 ("Destination Unreachable") so anything not
// already in E.164 gets converted here. Non-Israeli numbers fall
// through unchanged — Vonage handles those itself when E.164 is well-
// formed.
function normaliseIsraeliPhone(phone) {
  if (!phone) return phone;
  let p = String(phone).replace(/[\s()-]/g, '');
  if (p.startsWith('+972'))  return p;
  if (p.startsWith('972'))   return '+' + p;
  if (p.startsWith('00972')) return '+' + p.slice(2);
  if (p.startsWith('0'))     return '+972' + p.slice(1);
  // 9-digit Israeli mobile with the leading 0 stripped already
  if (/^\d{9}$/.test(p))     return '+972' + p;
  return phone;
}

/**
 * List every active admin user in auth_db so org.registered (and any
 * future admin-broadcast events) can SMS + email all of them rather
 * than the single ADMIN_EMAIL fallback. Cross-database query — the
 * notification service's pool is rooted at notif_db but the root
 * credential it uses has access to every schema.
 *
 * Returns rows with `{id, full_name, phone, email}`. Empty array when
 * no active admins exist (the caller falls back to ADMIN_EMAIL).
 */
const { getPool } = require('../db');
async function listAdminUsers() {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, full_name, phone, email
         FROM auth_db.users
        WHERE role = 'admin' AND is_active = TRUE`
    );
    return rows;
  } catch (err) {
    console.error('[handlers] listAdminUsers failed:', err.message);
    return [];
  }
}

async function sendSmsInternal(phone, message) {
  const normalised = normaliseIsraeliPhone(phone);
  try {
    const resp = await fetch(`${NOTIF_URL}/internal/sms`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone: normalised, message }),
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
//     search_id, should_notify, skipped,
//     contractor_id, contact_name, contact_phone, contact_email,
//     profession, region, worker_count, best_fill_pct
//   }
//
// We send SMS + email for every entry where should_notify=true. Skipped
// entries (debounced) are silently ignored.

async function notifyMatchFound(result, sendEmail) {
  if (!result || !result.should_notify) return;

  const matchUrl   = `${FRONTEND_URL}/contractor/searches/${result.search_id}`;
  const profession = result.profession || 'החיפוש שלך';
  const workerCt   = result.worker_count || 0;
  const smsBody    = `TagidAI — נמצאה התאמה מלאה לחיפוש "${profession}" (${workerCt} עובדים). לצפייה: ${matchUrl}`;

  // Fan-out across the contractor's notification recipients (Phase 1).
  // Falls back to the single contact_phone / contact_email pair when
  // the contractor hasn't configured a recipient list yet.
  await notifyEntity({
    entityType: 'contractor',
    entityId:   result.contractor_id,
    eventKey:   'match.found',
    emailVars: {
      contact_name: result.contact_name || '',
      profession,
      worker_count: workerCt,
      region:       result.region || '',
      match_url:    matchUrl,
    },
    smsText: smsBody,
    sendEmail, sendSms: sendSmsInternal,
    fallback: { email: result.contact_email, phone: result.contact_phone },
  });
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

// Materialise new `deals` rows for any corp the rematch surfaced that
// doesn't already have one against this search, and SMS both sides.
//
// Called off `worker.changed`: when a corp uploads/edits workers, the
// matcher may now reach a contractor's existing open search via a corp
// that wasn't present at search-creation time. The initial-match flow
// creates deals client-side (frontend per matched corp); the rematch
// flow has to create them here, otherwise neither side sees the new
// match in /contractor/deals or /corporation/deals.
async function materialiseNewDeals(result, sendEmail) {
  if (!result || !Array.isArray(result.matched_corps) || result.matched_corps.length === 0) return;
  if (!result.contractor_id || !result.search_id) return;

  // Existing (corp,deal) pairs for this search — skip corps already
  // covered, regardless of deal status (proposed/committed/cancelled/...).
  let existingCorps = new Set();
  try {
    const resp = await fetch(`${DEAL_URL}/deals/internal/by-search/${result.search_id}`);
    if (resp.ok) {
      const rows = await resp.json();
      for (const r of (rows || [])) existingCorps.add(r.corporation_id);
    } else {
      console.error('[rematch-deals] by-search non-2xx:', resp.status, await resp.text());
      return;
    }
  } catch (err) {
    console.error('[rematch-deals] by-search unreachable:', err.message);
    return;
  }

  const newCorps = result.matched_corps.filter((cid) => cid && !existingCorps.has(cid));
  if (newCorps.length === 0) return;

  // Translate profession code → Hebrew label for the corp-side SMS.
  const profHe = await translateProfession(result.profession);

  let createdAny = false;
  for (const corpId of newCorps) {
    let dealId = null;
    try {
      const resp = await fetch(`${DEAL_URL}/deals`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          // System-initiated: don't trip the "contractor must be tier_2"
          // gate inside create_deal. Any non-"contractor" role works.
          'x-user-role': 'system',
          'x-user-id':   'system-rematch',
        },
        body: JSON.stringify({
          search_id:      result.search_id,
          contractor_id:  result.contractor_id,
          corporation_id: corpId,
          proposed_by:    'system-rematch',
        }),
      });
      if (!resp.ok) {
        console.error('[rematch-deals] create non-2xx:', resp.status, await resp.text());
        continue;
      }
      const body = await resp.json();
      dealId = body?.id || null;
      createdAny = true;
    } catch (err) {
      console.error('[rematch-deals] create unreachable:', err.message);
      continue;
    }

    // SMS the corp that they now have a request waiting for them.
    let corpPhone = null;
    try {
      const r = await fetch(`${USER_ORG_URL}/organizations/corporations/${corpId}`);
      if (r.ok) {
        const data = await r.json();
        corpPhone = data?.contact_phone || null;
      }
    } catch (err) {
      console.error('[rematch-deals] corp lookup unreachable:', err.message);
    }
    if (corpPhone) {
      const corpLink = `${FRONTEND_URL}/corporation/deals`;
      await sendSmsInternal(
        corpPhone,
        `TagidAI — יש דרישה חדשה ממתינה לעובדי ${profHe}. אנא פתח את לוח העסקאות: ${corpLink}`
      );
    }
  }

  // SMS the contractor ONCE that an additional corp is now available.
  if (createdAny && result.contact_phone) {
    const dealsLink = `${FRONTEND_URL}/contractor/deals`;
    const firstName = (result.contact_name || '').split(' ')[0] || 'שלום';
    await sendSmsInternal(
      result.contact_phone,
      `TagidAI — ${firstName}, תאגיד נוסף יכול לתת מענה לדרישה שלך ל-${profHe}. היכנס לבדוק: ${dealsLink}`
    );
  }
}

async function rematchForSearch(searchId, force) {
  try {
    const resp = await fetch(`${JOB_MATCH_URL}/internal/rematch-for-search`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ search_id: searchId, force: !!force }),
    });
    if (!resp.ok) {
      console.error('[rematch-search] non-2xx:', resp.status, await resp.text());
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.error('[rematch-search] unreachable:', err.message);
    return null;
  }
}

/**
 * Route each event to the appropriate recipient + template.
 * sendEmail(eventKey, recipientEmail, recipientUserId, variables)
 */
async function handle(routingKey, payload, sendEmail) {
  switch (routingKey) {
    case 'org.registered': {
      // Notify every active admin so a new contractor / corporation
      // doesn't sit unattended in the approval queue. SMS for instant
      // attention + email for archival. Includes a deep link to the
      // /admin/approvals screen so the admin can triage in one click.
      const orgTypeLabel = payload.org_type === 'contractor' ? 'קבלן' : 'תאגיד';
      const adminLink    = `${FRONTEND_URL}/admin/approvals`;
      const admins       = await listAdminUsers();

      if (admins.length === 0) {
        // Fallback when no admin users in DB yet (fresh env, seeding
        // not done, etc.). Preserves the previous single-recipient
        // behaviour against the ADMIN_EMAIL env var so we don't lose
        // visibility entirely on a misconfigured deploy.
        await sendEmail('org.registered', ADMIN_EMAIL, null, {
          org_name:       payload.org_name,
          org_type_label: orgTypeLabel,
          admin_link:     adminLink,
        });
        break;
      }

      for (const admin of admins) {
        const firstName = (admin.full_name || '').split(' ')[0] || 'שלום';

        if (admin.phone) {
          await sendSmsInternal(
            admin.phone,
            `${firstName}, ${orgTypeLabel} חדש ממתין לאישור: ${payload.org_name}\n${adminLink}`,
          );
        }
        if (admin.email) {
          await sendEmail('org.registered', admin.email, admin.id, {
            org_name:       payload.org_name,
            org_type_label: orgTypeLabel,
            admin_link:     adminLink,
            contact_name:   admin.full_name || '',
          });
        }
      }
      break;
    }

    case 'org.approved':
      await sendEmail('org.approved', payload.contact_email, null, {
        contact_name: payload.contact_name,
        org_name:     payload.org_name,
      });
      // Send SMS with direct link — contractors get link to start a search
      if (payload.contact_phone) {
        const link = payload.org_type === 'contractor'
          ? `${FRONTEND_URL}/contractor/find`
          : `${FRONTEND_URL}/corporation/dashboard`;
        const firstName = (payload.contact_name || '').split(' ')[0] || 'שלום';
        await sendSmsInternal(
          payload.contact_phone,
          `${firstName}, החשבון שלך בפורטל TagidAI אושר ✓\n${payload.org_type === 'contractor' ? 'לאיתור עובדים: ' : 'כניסה לחשבון: '}${link}`
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

    case 'deal.proposed': {
      // Reaches the corporation team — every team member flagged as a
      // recipient gets it on the channels they chose. Legacy single-
      // contact fallback fires if no recipients are configured yet.
      const dealUrl = `${FRONTEND_URL}/corporation/deals/${payload.deal_id}`;
      const prof    = payload.profession_he || 'חיפוש חדש';
      await notifyEntity({
        entityType: 'corporation',
        entityId:   payload.corporation_id,
        eventKey:   'deal.proposed',
        emailVars: {
          contractor_name: payload.contractor_name || payload.contractor_id,
          profession:      prof,
          deal_id:         payload.deal_id,
          link:            dealUrl,
        },
        smsText: `דרישה חדשה לתאגיד — ${prof}. לצפייה ותגובה: ${dealUrl}`,
        sendEmail, sendSms: sendSmsInternal,
        fallback: { email: payload.corporation_email },
      });
      break;
    }

    case 'deal.accepted': {
      // Contractor side gets notified when their proposed deal flips to
      // accepted (contractor's own confirmation flow).
      const dealUrl = `${FRONTEND_URL}/contractor/deals/${payload.deal_id}`;
      const corp    = payload.corporation_name || 'התאגיד';
      await notifyEntity({
        entityType: 'contractor',
        entityId:   payload.contractor_id,
        eventKey:   'deal.accepted',
        emailVars: {
          corporation_name: corp,
          profession:       payload.profession_he || '',
          deal_id:          payload.deal_id,
          link:             dealUrl,
        },
        smsText: `העסקה אושרה — ${corp}. פרטים: ${dealUrl}`,
        sendEmail, sendSms: sendSmsInternal,
        fallback: { email: payload.contractor_email },
      });
      break;
    }

    case 'deal.discrepancy.flagged':
      await sendEmail('deal.discrepancy.flagged', ADMIN_EMAIL, null, {
        deal_id: payload.deal_id,
      });
      break;

    case 'message.new': {
      // Cross-party chat — payload.recipient_role tells us which side
      // owns the inbox we're notifying, so we look up the right entity.
      const recipientSide  = payload.recipient_role === 'contractor' ? 'contractor' : 'corporation';
      const recipientEntId = recipientSide === 'contractor'
        ? payload.contractor_id
        : payload.corporation_id;
      const dealUrl = `${FRONTEND_URL}/${recipientSide}/deals/${payload.deal_id}`;
      const senderLabel = payload.sender_role === 'contractor' ? 'הקבלן'
                       : payload.sender_role === 'corporation' ? 'התאגיד'
                       : 'משתמש';
      if (recipientEntId) {
        await notifyEntity({
          entityType: recipientSide,
          entityId:   recipientEntId,
          eventKey:   'message.new',
          emailVars: { deal_id: payload.deal_id, sender_name: senderLabel, link: dealUrl },
          smsText:   `הודעה חדשה מ${senderLabel} בעסקה. צפייה: ${dealUrl}`,
          sendEmail, sendSms: sendSmsInternal,
          fallback: { email: payload.recipient_email },
        });
      } else if (payload.recipient_email) {
        // Legacy path before the deal-service started attaching ids.
        await sendEmail('message.new', payload.recipient_email, null, {
          deal_id: payload.deal_id, sender_name: senderLabel,
        });
      }
      break;
    }

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
      const message     = `שלום! ${inviterName} מזמין אותך להצטרף לצוות "${entityName}" בפורטל TagidAI בתפקיד ${roleLabel}.\nלהתחברות והצטרפות לפלטפורמה:\n${inviteUrl}`;
      await sendSmsInternal(payload.phone, message);
      break;
    }

    // Inverted-invite flow — a NEW user tried to register a corp/
    // contractor whose ח.פ already has an active org. We capture them
    // as a membership_request and SMS the existing owner a magic link
    // to one-click approve adding them as a team member.
    case 'team.membership_request.created': {
      if (!payload.owner_phone) break;
      const approveUrl = `${FRONTEND_URL}/membership-request/accept/${payload.approval_token}`;
      const entityKindHe = payload.entity_type === 'contractor' ? 'הקבלן' : 'התאגיד';
      const ownerName    = (payload.owner_name || '').split(' ')[0] || 'שלום';
      const message =
        `TagidAI — ${ownerName}, ${payload.requester_name} (${payload.requester_phone}) מבקש להצטרף לצוות ${entityKindHe} "${payload.entity_name}".\n` +
        `לאישור בלחיצה אחת:\n${approveUrl}`;
      await sendSmsInternal(payload.owner_phone, message);
      break;
    }

    case 'team.membership_request.approved': {
      if (!payload.requester_phone) break;
      const entityKindHe = payload.entity_type === 'contractor' ? 'הקבלן' : 'התאגיד';
      const firstName = (payload.requester_name || '').split(' ')[0] || 'שלום';
      const message =
        `TagidAI — ${firstName}, בקשתך להצטרף לצוות ${entityKindHe} אושרה. תוכל להיכנס למערכת עם מספר הטלפון שלך.\n` +
        `${FRONTEND_URL}/login`;
      await sendSmsInternal(payload.requester_phone, message);
      break;
    }

    case 'team.membership_request.rejected': {
      if (!payload.requester_phone) break;
      const entityKindHe = payload.entity_type === 'contractor' ? 'הקבלן' : 'התאגיד';
      const firstName = (payload.requester_name || '').split(' ')[0] || 'שלום';
      const reasonSuffix = payload.reason ? `\nהערה: ${payload.reason}` : '';
      const message =
        `TagidAI — ${firstName}, בקשתך להצטרף לצוות ${entityKindHe} נדחתה על ידי הבעלים.` +
        reasonSuffix +
        '\nלשאלות, פנה לתמיכה.';
      await sendSmsInternal(payload.requester_phone, message);
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
        `TagidAI — קוד אימות בעלות לעסק שלך: ${payload.code}\n` +
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
          `TagidAI — ${firstName}, הרישום של ${payload.company_name || 'העסק שלך'} כבר לא מופיע בפנקס הקבלנים. ` +
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
          `TagidAI — ${firstName}, החשבון שלך אומת בהצלחה ✓ אתה יכול עכשיו להגיש בקשות לתאגידים. ` +
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
          `TagidAI — ${firstName}, תאגיד הציע ${vars.worker_count} עובדי ${vars.profession_he} לבקשתך. ` +
          `יש לך 48 שעות לאשר. כניסה: ${dealUrl}`
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
        const tail = isFreeLaunchActive()
          ? 'ההשקה הזו חינם — לא תחויב.'
          : `חיוב יבוצע ב-${captureFmt} (אלא אם התאגיד יבטל בחלון הזמן).`;
        await sendSmsInternal(
          payload.contractor_contact_phone,
          `TagidAI — ${firstName}, אישרת רשימה של ${payload.worker_count} עובדים. ${tail}`
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
          `TagidAI — ${firstName}, ${payload.corp_name || 'התאגיד'} ביטל את העסקה לפני החיוב. לא חויבת. ` +
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
      //
      // Two downstream effects per rematch result:
      //   1. notifyMatchFound — fires only on the "first time we hit
      //      complete" edge, sends the legacy "match found!" SMS/email.
      //   2. materialiseNewDeals — creates `deals` rows for any newly
      //      matching corp and SMSes both sides, every rematch where
      //      a new corp appears (independent of the complete edge).
      const results = await rematchForCorp(payload.corporation_id, payload.profession_type);
      for (const r of results) {
        await notifyMatchFound(r, sendEmail);
        await materialiseNewDeals(r, sendEmail);
      }
      break;
    }

    case 'worker_search.changed': {
      // Contractor created/edited their own search. Re-match just this
      // one, force=true to bypass the debounce (the contractor's edit
      // should be reflected immediately).
      const result = await rematchForSearch(payload.search_id, true);
      await notifyMatchFound(result, sendEmail);
      await materialiseNewDeals(result, sendEmail);
      break;
    }

    case 'search.no_match':
      // Contractor's search returned 0 results. SMS every approved corp
      // ("תאגיד מאושר" — verification_tier='tier_2') with the same
      // recruitment_type so they know there's a contractor waiting.
      // Best-effort: failures on individual sends don't bubble out.
      await broadcastNoMatch(payload);
      break;

    // ── Foreign-import tenders ──────────────────────────────────────

    case 'tender.published':
      // A contractor published an import tender. Broadcast to every
      // tier_2 corp so they can bid. Contractor stays anonymous.
      await broadcastTender(payload);
      break;

    case 'tender.bid_submitted':
      // A corp bid on a tender — nudge the contractor to review.
      await notifyContractorOfBid(payload);
      break;

    case 'tender.revealed':
      // Admin approved + revealed. Tell the contractor + each winning
      // corp that identities are now visible and they can connect.
      await notifyTenderRevealed(payload);
      break;

    default:
      console.warn(`[handlers] No handler for: ${routingKey}`);
  }
}

/**
 * Fan-out SMS for the search.no_match event. Pulls every active
 * tier_2 corporation that registered for the same recruitment_type
 * (foreign vs domestic) and sends each one a Hebrew SMS pointing at
 * the workers-upload screen. The user-org service exposes the corp
 * directory; we accept its 200/[] result as the source of truth.
 */
async function broadcastNoMatch(payload) {
  const profHe = await translateProfession(payload.profession_type);
  const region = payload.region ? ` באזור ${payload.region}` : '';
  const qty = payload.quantity || 1;
  const recruitment = payload.recruitment_type === 'foreign' ? 'מחו״ל' : 'מהארץ';
  // Resolve the corp directory. user-org exposes
  // GET /organizations/corporations?tier=tier_2&recruitment_type=...
  // (added in Wave 5 specifically for this broadcast).
  let corps = [];
  try {
    const url = `${USER_ORG_URL}/organizations/corporations?tier=tier_2&recruitment_type=${encodeURIComponent(payload.recruitment_type || '')}`;
    const resp = await fetch(url);
    if (resp.ok) corps = await resp.json();
  } catch (err) {
    console.error('[no_match] corp directory unreachable:', err.message);
    return;
  }
  if (!Array.isArray(corps) || corps.length === 0) return;

  const uploadLink = `${FRONTEND_URL}/corporation/workers/new`;
  const message =
    `TagidAI — קבלן מחפש ${qty} עובדי ${profHe} ${recruitment}${region}, ולא נמצאו התאמות פעילות.\n` +
    `אם יש לכם עובדים זמינים — זה הזמן להעלות אותם למערכת:\n${uploadLink}`;

  for (const c of corps) {
    if (!c?.contact_phone) continue;
    await sendSmsInternal(c.contact_phone, message);
  }
}

/**
 * profession_type → Hebrew display label, via worker service's enum
 * endpoint. Falls back to the raw code if the lookup fails — the SMS
 * is still useful, just less polished.
 */
async function translateProfession(code) {
  if (!code) return 'עובדים';
  try {
    const resp = await fetch(`${process.env.WORKER_SERVICE_URL || 'http://worker:3003'}/enums/professions`);
    if (!resp.ok) return code;
    const list = await resp.json();
    const hit = Array.isArray(list) && list.find((p) => p.code === code);
    return hit?.name_he || code;
  } catch {
    return code;
  }
}

// ── Foreign-tender notification helpers ─────────────────────────────

async function fetchCorpPhone(corpId) {
  try {
    const r = await fetch(`${USER_ORG_URL}/organizations/corporations/${corpId}`);
    if (r.ok) { const c = await r.json(); return c?.contact_phone || null; }
  } catch (err) { console.error('[tender] corp lookup unreachable:', err.message); }
  return null;
}

async function fetchContractorPhone(contractorId) {
  try {
    const r = await fetch(`${USER_ORG_URL}/organizations/contractors/${contractorId}`);
    if (r.ok) { const c = await r.json(); return c?.contact_phone || null; }
  } catch (err) { console.error('[tender] contractor lookup unreachable:', err.message); }
  return null;
}

/**
 * tender.published — fan out to every active tier_2 corporation. The
 * contractor's identity is NOT included (double-blind); the SMS just
 * says "a new import tender is open, go bid".
 */
async function broadcastTender(payload) {
  const profCount = Array.isArray(payload.professions) ? payload.professions.length : 0;
  const qty = payload.total_quantity || 0;
  let corps = [];
  try {
    // foreign tenders → corps that recruit foreign workers (tier_2).
    const url = `${USER_ORG_URL}/organizations/corporations?tier=tier_2&recruitment_type=foreign`;
    const resp = await fetch(url);
    if (resp.ok) corps = await resp.json();
  } catch (err) {
    console.error('[tender.published] corp directory unreachable:', err.message);
    return;
  }
  if (!Array.isArray(corps) || corps.length === 0) return;

  const link = `${FRONTEND_URL}/corporation/tenders`;
  const message =
    `TagidAI — מכרז ייבוא חדש: קבלן מבקש ${qty} עובדים מחו״ל ` +
    `(${profCount} מקצועות). אם תוכלו לספק — הגישו הצעה: ${link}`;

  for (const c of corps) {
    if (!c?.contact_phone) continue;
    await sendSmsInternal(c.contact_phone, message);
  }
}

/**
 * tender.bid_submitted — nudge the contractor that a new bid landed.
 */
async function notifyContractorOfBid(payload) {
  if (!payload.contractor_id) return;
  const phone = await fetchContractorPhone(payload.contractor_id);
  if (!phone) return;
  const link = `${FRONTEND_URL}/contractor/tenders/${payload.tender_id}`;
  await sendSmsInternal(
    phone,
    `TagidAI — התקבלה הצעה חדשה למכרז הייבוא שלך. היכנס לבדוק ולבחור: ${link}`,
  );
}

/**
 * tender.revealed — admin approved + unblinded. Notify the contractor
 * and each winning corp that they can now see each other + connect.
 */
async function notifyTenderRevealed(payload) {
  const contractorLink = `${FRONTEND_URL}/contractor/tenders/${payload.tender_id}`;
  const corpLink       = `${FRONTEND_URL}/corporation/tenders/${payload.tender_id}`;

  if (payload.contractor_id) {
    const cPhone = await fetchContractorPhone(payload.contractor_id);
    if (cPhone) {
      await sendSmsInternal(
        cPhone,
        `TagidAI — מכרז הייבוא אושר ע״י מנהל המערכת. פרטי התאגיד הזוכה נחשפו: ${contractorLink}`,
      );
    }
  }
  for (const corpId of (payload.corporation_ids || [])) {
    const phone = await fetchCorpPhone(corpId);
    if (phone) {
      await sendSmsInternal(
        phone,
        `TagidAI — זכיתם במכרז ייבוא עובדים! פרטי הקבלן נחשפו, ניתן ליצור קשר: ${corpLink}`,
      );
    }
  }
}

module.exports = { handle };
