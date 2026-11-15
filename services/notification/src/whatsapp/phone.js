// Meta sends and expects phone numbers as bare digits (972501234567).
// auth_db.users.phone, and every row this service writes, holds E.164
// with the plus (+972501234567). One canonical form, one wire form.

function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('0'))  return `+972${digits.slice(1)}`;
  return `+${digits}`;
}

function toWaId(raw) {
  const phone = normalizePhone(raw);
  return phone ? phone.slice(1) : null;
}

module.exports = { normalizePhone, toWaId };
