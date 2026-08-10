// Central api-error → Hebrew mapper.
//
// Every backend service that follows the P0-1 contract now returns:
//   { error: '<stable_code>', message: '<hebrew display text>', ... }
// The frontend's job is:
//   1. Prefer the server-supplied `message` when it exists (backends
//      own the wording and can localize/version it without a FE deploy).
//   2. Fall back to a per-code map for endpoints that predate the
//      contract, or when the response body is missing / opaque.
//   3. Fall back to a sane generic default — NEVER surface a raw code
//      like `internal_error` or an English/technical string.
//
// Duplicating this in per-page `otpError` / `otpErrorMsg` helpers is
// exactly what caused the "שגיאה בשליחת הקוד" surprise (a new backend
// code the pages didn't know about). Use `mapApiError` everywhere the
// UI shows an error string.

// Stable machine codes (and legacy English prose strings) → Hebrew.
//
// P0-4 sweep — pre-P0-4 the scanner flagged 287 rows as
// english-in-user-text; 278 of them were api-error rows whose detail
// value would leak to the UI if unmapped. Adding every code the
// backends throw as a key here neutralises the whole class in one
// edit: the FE renders Hebrew regardless of what shape the backend
// returned (snake_case code, "Human Sentence", or a mid-refactor mix
// of both). Grouped by concern so a new code slots into the right
// section instead of being appended at random.
const CODE_TO_HE: Record<string, string> = {
  // ── generic ────────────────────────────────────────────────
  internal_error:        'קרתה תקלה, נסה שוב עוד רגע',
  bad_request:           'הבקשה לא תקינה. בדוק את השדות ונסה שוב',
  unauthorized:          'לא מורשה. יש להיכנס למערכת',
  unauthenticated:       'יש להתחבר כדי להמשיך',
  auth_required:         'יש להתחבר כדי להמשיך',
  not_authorized:        'הפעולה אינה מותרת לחשבון זה',
  forbidden:             'הפעולה אינה מותרת לחשבון זה',
  not_found:             'לא נמצא',
  service_unavailable:   'השירות זמנית לא זמין. נסה שוב עוד רגע',
  rate_limited:          'יותר מדי בקשות, נסה שוב עוד רגע',
  network_error:         'בעיה בחיבור לרשת. בדוק את החיבור ונסה שוב',
  handler_failed:        'קרתה תקלה, נסה שוב עוד רגע',
  cron_failed:           'הפעולה המתוזמנת נכשלה — פנה לתמיכה',
  no_changes:            'אין שינויים לשמור',
  admin_only:            'הפעולה זמינה למנהלי מערכת בלבד',
  corp_only:             'הפעולה זמינה לחשבונות תאגיד בלבד',
  no_entity_context:     'יש לבחור ישות פעילה כדי להמשיך',

  // ── auth / OTP (P0-1) ──────────────────────────────────────
  phone_required:        'יש להזין מספר טלפון',
  invalid_phone:         'מספר טלפון לא תקין. יש להזין מספר ישראלי בפורמט 05XXXXXXXX',
  invalid_purpose:       'בקשה לא תקינה',
  invalid_email:         'כתובת אימייל לא תקינה',
  invalid_email_tld:     'סיומת האימייל אינה מזוהה. בדוק את הכתובת',
  missing_fields:        'חסר מידע בבקשה',
  missing_required_fields:'חסר מידע בבקשה',
  wrong_code:            'קוד לא נכון. נסה שנית',
  max_attempts:          'יותר מדי ניסיונות שגויים. בקש קוד חדש',
  otp_expired:           'הקוד פג תוקף. שלח קוד חדש',
  otp_expired_or_not_found: 'הקוד פג תוקף. שלח קוד חדש',
  otp_send_failed:       'שליחת הקוד נכשלה. נסה שוב עוד רגע',
  no_recent_otp:         'לא נמצא קוד תקף — בקש קוד חדש',
  sms_send_failed:       'שליחת ה-SMS נכשלה. נסה שוב עוד רגע',
  user_not_found:        'מספר הטלפון לא רשום במערכת',
  use_phone_login:       'חשבון זה מחייב כניסה עם SMS / WhatsApp',
  phone_not_verified:    'אימות הטלפון פג תוקף. חזור לשלב הראשון',
  phone_mismatch:        'מספר הטלפון לא תואם להזמנה',
  already_registered:    'מספר הטלפון כבר רשום. אנא התחבר',
  email_already_in_use:  'כתובת האימייל כבר בשימוש',
  phone_exists:          'מספר הטלפון כבר רשום. אנא התחבר',
  invite_expired:        'ההזמנה פגה. פנה לשולח לקבלת הזמנה חדשה',
  invite_not_found_or_used: 'ההזמנה כבר בשימוש או לא נמצאה',
  invalid_role:          'התפקיד אינו תקין',
  invalid_entity_type:   'סוג הישות אינו תקין',
  invalid_org_type:      'סוג הישות אינו תקין',
  invalid_status:        'הסטטוס אינו תקין',
  invalid_tier:          'הרמה אינה תקינה',
  entity_id_and_type_required: 'חסר מידע על הישות',

  // ── organizations / registration ───────────────────────────
  invalid_business_number:  'מספר ע.מ / ח.פ אינו תקין',
  business_number_taken:    'מספר ע.מ / ח.פ זה כבר רשום במערכת',
  company_blocked:          'החברה רשומה במצב לא פעיל ברשם החברות',
  contractor_not_found:     'הקבלן לא נמצא',
  corporation_not_found:    'התאגיד לא נמצא',
  org_not_found:            'הישות לא נמצאה',
  contractor_already_registered:  'קבלן עם ח.פ זה כבר רשום במערכת',
  corporation_already_registered: 'תאגיד עם ח.פ זה כבר רשום במערכת',
  phone_already_contractor:  'מספר טלפון זה כבר רשום כקבלן. אנא היכנס במקום להירשם',
  phone_already_corporation: 'מספר טלפון זה כבר רשום כתאגיד. אנא היכנס במקום להירשם',
  already_have_contractor:   'כבר יש לך חשבון קבלן',
  already_have_corporation:  'כבר יש לך חשבון תאגיד',
  forbidden_kablan_verify:   'רק בעל החשבון יכול לאמת רישיון קבלן',
  forbidden_member_manage:   'רק בעלים או מנהלים יכולים לנהל חברי צוות',
  forbidden_recipient_manage:'רק בעלים או מנהלים יכולים לנהל נמענים להתראות',
  membership_not_found:      'חברות הצוות לא נמצאה',
  inactive_member:           'חבר הצוות אינו פעיל',
  not_a_member:              'החשבון אינו חבר בישות זו',
  cannot_demote_sole_owner:  'לא ניתן להוריד את הבעלים היחיד',
  cannot_remove_sole_owner:  'לא ניתן להסיר את הבעלים היחיד',
  need_at_least_one_contact: 'יש להשאיר לפחות ערוץ קשר אחד',
  recipient_cap_reached:     'הגעת למספר הנמענים המקסימלי לישות',
  seat_limit:                'הגעת למכסת המשתמשים במסלול שלך',
  advertiser_required:       'רק מפרסמים יכולים לבצע פעולה זו',
  advertiser_not_approved:   'המפרסם עדיין לא אושר על ידי מנהל המערכת',
  request_not_found:         'הבקשה לא נמצאה',

  // ── ads / marketplace ──────────────────────────────────────
  ad_not_found:              'המודעה לא נמצאה',
  invalid_ad_type:           'סוג המודעה אינו תקין',
  category_not_found:        'הקטגוריה לא נמצאה',
  category_code_taken:       'קוד הקטגוריה כבר בשימוש',
  category_required:         'יש לבחור קטגוריה',
  country_not_found:         'המדינה לא נמצאה',
  invalid_country_code:      'קוד המדינה אינו תקין',
  listing_not_found:         'הפרסום לא נמצא',
  already_subscribed_to_category: 'כבר יש מנוי פעיל לקטגוריה זו',
  tier_active_ad_limit:      'הגעת למכסת המודעות הפעילות במסלול שלך',
  tier_boost_not_allowed:    'המסלול הנוכחי לא מאפשר קידום מודעות',
  tier_reveal_limit:         'הגעת למכסת החשיפות במסלול שלך',
  tier_unavailable:          'המסלול הנוכחי אינו זמין. פנה לתמיכה',
  tier_not_found:            'המסלול לא נמצא',
  tier_in_use_set_inactive_instead: 'המסלול בשימוש — הפוך אותו ללא-פעיל במקום למחוק',
  title_required:            'יש להזין כותרת',
  name_required:             'יש להזין שם',
  message_required:          'יש להזין תוכן הודעה',
  at_least_one_profession_required: 'יש לבחור לפחות מקצוע אחד',
  invalid_channels:          'ערוצי הקשר שנבחרו אינם תקינים',
  invalid_source_year:       'שנת המקור אינה תקינה',
  invalid_line_ids:          'שורות הבקשה אינן תקינות',
  too_many_items_max_50:     'ניתן לבחור עד 50 פריטים בפעולה אחת',
  no_items:                  'לא נבחרו פריטים לפעולה',
  no_fields_to_update:       'אין שדות לעדכון',
  no_editable_fields:        'אין שדות שניתן לערוך במצב הנוכחי',
  no_selected_bids:          'לא נבחרו הצעות',
  no_slots_available:        'אין משבצות זמינות',
  no_subscription:           'אין לך מנוי פעיל',
  no_active_subscription:    'אין לך מנוי פעיל',
  subscription_not_found:    'המנוי לא נמצא',
  subscription_required:     'הפעולה מחייבת מנוי פעיל',
  plan_not_found:            'המסלול לא נמצא',
  period_not_found:          'תקופת החיוב לא נמצאה',
  percent_out_of_range:      'האחוז שהוזן מחוץ לטווח המותר',
  valid_until_before_valid_from: 'תאריך הסיום חייב להיות אחרי תאריך ההתחלה',
  grace_period:              'המנוי בתקופת חסד — נא לעדכן אמצעי תשלום',
  cardcom_not_configured:    'שירות התשלום אינו מוגדר. פנה לתמיכה',
  cardcom_recurring_not_wired_yet: 'החיוב החוזר אינו מחובר עדיין. פנה לתמיכה',
  cloudinary_not_configured: 'שירות תמונות אינו מוגדר. פנה לתמיכה',
  not_configured:            'השירות אינו מוגדר. פנה לתמיכה',

  // ── tenders / bids ─────────────────────────────────────────
  tender_not_found:          'הבקשה לא נמצאה',
  tender_locked:             'הבקשה נעולה ולא ניתן לערוך',
  tender_not_accepting_bids: 'הבקשה סגורה להגשות',
  bid_not_found:             'ההצעה לא נמצאה',
  bid_not_pending:           'ניתן לערוך רק הצעות ממתינות לאישור',
  bid_must_offer_workers:    'ההצעה חייבת לכלול עובדים',
  only_contractor_can_publish: 'רק הקבלן מפרסם הבקשה יכול לפרסם אותה',
  only_corporation_can_bid:  'רק תאגידים יכולים להגיש הצעות',
  cannot_freeze:             'לא ניתן להקפיא את הבקשה במצב הנוכחי',
  not_frozen:                'הבקשה אינה במצב מוקפא',
  not_editable:              'לא ניתן לערוך במצב הנוכחי',
  not_pending_publish:       'הבקשה אינה ממתינה לפרסום',
  select_at_least_one_line:  'יש לבחור לפחות שורה אחת',
  has_responses_cannot_edit: 'לא ניתן לערוך — התקבלו כבר הצעות',
  has_responses_cannot_edit_items: 'לא ניתן לערוך פריטים — התקבלו כבר הצעות',
  missing_hourly_rate:       'חסר תעריף שעתי',

  // ── workers / other resources ──────────────────────────────
  worker_not_found:          'העובד לא נמצא',
  lead_not_found:            'הפניה לא נמצאה',
  ticket_not_found:          'פנייה לא נמצאה',
  payment_method_not_found:  'אמצעי התשלום לא נמצא',
  not_a_pdf:                 'הקובץ שנשלח אינו PDF',
  empty_file:                'הקובץ ריק',
  auth_service_unreachable:  'שירות ההזדהות אינו זמין. נסה שוב עוד רגע',
  entitlement_service_unreachable: 'שירות ההרשאות אינו זמין. נסה שוב עוד רגע',
  payload_hash_mismatch:     'הבקשה שהתקבלה אינה תואמת. נסה שוב',
  invalid_vonage_signature:  'התשובה שהתקבלה אינה תקינה. פנה לתמיכה',

  // ── legacy English-prose strings that some backends still throw ─
  // (equivalent to the snake_case keys above; kept so the lookup
  // hits regardless of which shape a given endpoint used before P0-4.)
  'Admin only':                       'הפעולה זמינה למנהלי מערכת בלבד',
  'Auth required for mine=true':      'יש להתחבר כדי לראות את הפריטים שלך',
  'Contractor not found':             'הקבלן לא נמצא',
  'Corporation not found':            'התאגיד לא נמצא',
  'Forbidden':                        'הפעולה אינה מותרת לחשבון זה',
  'Listing not found':                'הפרסום לא נמצא',
  'No fields to update':              'אין שדות לעדכון',
  'Organisation not found':           'הישות לא נמצאה',
  'Organization not found':           'הישות לא נמצאה',
  'Payment method not found':         'אמצעי התשלום לא נמצא',
  'Phone already registered':         'מספר הטלפון כבר רשום. אנא התחבר',
  'Service unavailable':              'השירות זמנית לא זמין. נסה שוב עוד רגע',
  'Unauthorized':                     'לא מורשה. יש להיכנס למערכת',
  'Worker not found':                 'העובד לא נמצא',
  'invalid credentials':              'פרטי הכניסה שגויים',
  'invalid refresh token':            'הפעלת הכניסה פגה. יש להתחבר מחדש',
  'invalid token':                    'הפעלת הכניסה פגה. יש להתחבר מחדש',
  'token revoked':                    'הפעלת הכניסה בוטלה. יש להתחבר מחדש',
  'token revoked or expired':         'הפעלת הכניסה פגה. יש להתחבר מחדש',
  'no token':                         'יש להתחבר כדי להמשיך',
  'user not found':                   'מספר הטלפון לא רשום במערכת',
  'email and password required':      'יש להזין אימייל וסיסמה',
  'phone and code required':          'יש להזין טלפון וקוד אימות',
  'phone and message required':       'יש להזין טלפון ותוכן הודעה',
  'refresh_token required':           'חסר מידע על הפעלת הכניסה',
  'token required':                   'חסר טוקן הזדהות',
  'contractor_id required':           'חסר מזהה קבלן',
  'corporation_id required':          'חסר מזהה תאגיד',
  'entity_id and entity_type required':'חסר מידע על הישות',
  'event_type required':              'חסר מידע על סוג האירוע',
  'full_name required for new users': 'משתמש חדש חייב להזין שם מלא',
  'invalid org_type':                 'סוג הישות אינו תקין',
  'org_type must be contractor or corporation': 'סוג הישות אינו תקין',
  'quantity must be 1-50':            'הכמות חייבת להיות בין 1 ל-50',
  'role required':                    'יש לבחור תפקיד',
  'missing_messageId':                'חסר מזהה הודעה',
};

export const DEFAULT_MESSAGE = 'קרתה תקלה, נסה שוב';

// ── server error shape (P0-1) ─────────────────────────────────
export interface ApiErrorPayload {
  error?:   string;                 // machine code
  message?: string;                 // Hebrew display
  detail?:  string | ApiErrorPayload;
  code?:    string;                 // some legacy shapes
  status?:  number;
  retryAfter?: number;
  remaining?:  number;
}

// Turn any thrown/caught error from `apiFetch` into a Hebrew string.
// Accepts:
//   - Error whose `.message` is a code (legacy apiFetch behaviour)
//   - Error whose `.message` is already Hebrew (server sent .message)
//   - Raw response body object with { error, message, ... }
//   - null / undefined / anything else → DEFAULT_MESSAGE
export function mapApiError(err: unknown): string {
  const payload = normalize(err);

  // 1) Prefer server-supplied Hebrew message when present
  if (payload.message && looksHebrew(payload.message)) return payload.message;

  // 2) Look up by machine code
  const code = payload.error || payload.code;
  if (code && CODE_TO_HE[code]) return CODE_TO_HE[code];

  // 3) Fall back to the message even if it's not Hebrew — better than a
  //    raw code, and the caller can still catch English leaks in QA.
  if (payload.message) return payload.message;

  // 4) Absolute last resort
  return DEFAULT_MESSAGE;
}

function normalize(err: unknown): ApiErrorPayload {
  if (!err) return {};
  if (typeof err === 'string')                          return { error: err };
  if (err instanceof Error) {
    // Errors thrown by apiFetch have their message set to a code OR a
    // Hebrew string — either way, try both interpretations.
    const m = err.message.trim();
    if (CODE_TO_HE[m])       return { error: m };
    if (looksHebrew(m))      return { message: m };
    // Some callers stash the parsed body on `.cause`
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause && typeof cause === 'object') return cause as ApiErrorPayload;
    return { error: m };
  }
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    // Nested { detail: {...} } from FastAPI
    if (o.detail && typeof o.detail === 'object') {
      return { ...(o.detail as ApiErrorPayload), ...(o as ApiErrorPayload) };
    }
    return o as ApiErrorPayload;
  }
  return {};
}

function looksHebrew(s: string): boolean {
  // Any Hebrew char in the string qualifies. RTL text often mixes
  // digits/punctuation, so we don't require the string to be majority
  // Hebrew — just to contain at least one Hebrew letter.
  return /[֐-׿]/.test(s);
}
