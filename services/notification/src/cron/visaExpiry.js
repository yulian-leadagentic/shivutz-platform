const amqp = require('amqplib');

const RABBITMQ_URL  = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const EXCHANGE_NAME = 'marketplace.events';
const WORKER_URL    = process.env.WORKER_SERVICE_URL || 'http://worker:3003';

async function runVisaExpiryCron() {
  // Fetch workers with visas expiring within 30 days via worker service
  const res = await fetch(`${WORKER_URL}/workers?status=available`);
  if (!res.ok) throw new Error('Worker service unavailable');
  const workers = await res.json();

  const today = new Date();
  const in30  = new Date(today); in30.setDate(today.getDate() + 30);
  const in7   = new Date(today); in7.setDate(today.getDate() + 7);

  const conn    = await amqp.connect(RABBITMQ_URL);
  const channel = await conn.createChannel();
  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

  for (const w of workers) {
    if (!w.visa_valid_until) continue;
    const expiry = new Date(w.visa_valid_until);

    if (expiry < today && w.status !== 'deactivated') {
      await publish(channel, 'worker.visa.expired', {
        worker_id:         w.id,
        worker_name:       `${w.first_name} ${w.last_name}`,
        corporation_id:    w.corporation_id,
      });
    } else if (expiry <= in7) {
      await publish(channel, 'worker.visa.expiring_7d', {
        worker_id:      w.id,
        worker_name:    `${w.first_name} ${w.last_name}`,
        corporation_id: w.corporation_id,
        visa_date:      w.visa_valid_until,
      });
    } else if (expiry <= in30 && !w.visa_alert_sent) {
      await publish(channel, 'worker.visa.expiring_30d', {
        worker_id:      w.id,
        worker_name:    `${w.first_name} ${w.last_name}`,
        corporation_id: w.corporation_id,
        visa_date:      w.visa_valid_until,
      });
    }
  }

  await conn.close();
  console.log('[cron] Visa expiry check complete');
}

async function publish(channel, key, payload) {
  channel.publish(EXCHANGE_NAME, key, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
    contentType: 'application/json',
  });
}

module.exports = { runVisaExpiryCron };
