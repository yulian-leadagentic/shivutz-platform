const amqp = require('amqplib');
const { sendEmail } = require('../mailer/sendgrid');
const handlers = require('./handlers');

const RABBITMQ_URL   = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';
const EXCHANGE_NAME  = 'marketplace.events';

async function startConsumer() {
  let conn;
  // Retry until RabbitMQ is ready
  for (let i = 0; i < 10; i++) {
    try {
      conn = await amqp.connect(RABBITMQ_URL);
      break;
    } catch {
      console.log(`[consumer] RabbitMQ not ready, retry ${i + 1}/10...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (!conn) throw new Error('Could not connect to RabbitMQ');

  const channel = await conn.createChannel();
  await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });

  const { queue } = await channel.assertQueue('notifications.all', { durable: true });

  // Bind all relevant routing keys
  const keys = [
    'org.registered', 'org.approved', 'org.rejected', 'org.sla.warning',
    'deal.proposed', 'deal.accepted', 'deal.discrepancy.flagged',
    'message.new', 'commission.invoiced',
    'worker.visa.expiring_30d', 'worker.visa.expiring_7d', 'worker.visa.expired',
    'team.invited',   // Phase 4: SMS invitation
  ];
  for (const key of keys) {
    await channel.bindQueue(queue, EXCHANGE_NAME, key);
  }

  channel.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      const routingKey = msg.fields.routingKey;
      const payload    = JSON.parse(msg.content.toString());
      console.log(`[consumer] Received: ${routingKey}`);
      await handlers.handle(routingKey, payload, sendEmail);
      channel.ack(msg);
    } catch (err) {
      console.error('[consumer] Handler error:', err.message);
      channel.nack(msg, false, false); // Dead-letter, don't requeue
    }
  });

  console.log('[consumer] Listening for events...');
}

module.exports = { startConsumer };
