/**
 * SMS Stub — development / test provider
 * Logs to console, never calls an external API.
 * Set SMS_PROVIDER=stub (or leave unset — it is the default).
 */
async function send(phone, message) {
  const msgId = `stub-${Date.now()}`;
  console.log(`\n[SMS STUB] ─────────────────────────────`);
  console.log(`[SMS STUB] TO:  ${phone}`);
  console.log(`[SMS STUB] MSG: ${message}`);
  console.log(`[SMS STUB] ID:  ${msgId}`);
  console.log(`[SMS STUB] ─────────────────────────────\n`);
  return { messageId: msgId };
}

module.exports = { send };
