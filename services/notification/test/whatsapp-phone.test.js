// R35 §4.1 · one phone normaliser, both directions.
//
// Meta's webhook gives the sender as bare digits (972501234567) and
// the Graph API wants the recipient the same way. auth_db.users.phone
// holds +972501234567. A mismatch here does not raise an error: the
// sender is simply never recognised and every contractor searches as
// an anonymous visitor.
//
// Run: node test/whatsapp-phone.test.js

const { check, finish, load } = require('./helpers');

const { normalizePhone, toWaId } = load('whatsapp/phone');

// Meta → DB
check('Meta wa_id becomes the E.164 form the DB stores', normalizePhone('972501234567') === '+972501234567');
check('a number already in DB form is left alone', normalizePhone('+972501234567') === '+972501234567');
check('Israeli local form gains the country code', normalizePhone('0501234567') === '+972501234567');
check('formatting characters are dropped', normalizePhone('050-123 4567') === '+972501234567');
check('00 international prefix is read as +', normalizePhone('00972501234567') === '+972501234567');
check('a non-Israeli wa_id only gains the plus', normalizePhone('16505551234') === '+16505551234');
check('a number given as a number still normalises', normalizePhone(972501234567) === '+972501234567');
for (const empty of [undefined, null, '', '   ', '+', 'abc']) {
  check(`${JSON.stringify(empty)} has no number in it and gives null`, normalizePhone(empty) === null);
}

// DB → Meta
check('DB form goes on the wire without the plus', toWaId('+972501234567') === '972501234567');
check('wire form is unchanged by a second pass', toWaId('972501234567') === '972501234567');
check('local form goes on the wire with the country code', toWaId('0501234567') === '972501234567');
check('no number gives null on the wire side too', toWaId('') === null);

// Round trip: what the webhook delivers is what the reply is sent to.
for (const waId of ['972501234567', '972549876543', '16505551234', '447911123456']) {
  check(`${waId} survives Meta → DB → Meta`, toWaId(normalizePhone(waId)) === waId);
}
for (const stored of ['+972501234567', '+16505551234']) {
  check(`${stored} survives DB → Meta → DB`, normalizePhone(toWaId(stored)) === stored);
}

finish('whatsapp-phone');
