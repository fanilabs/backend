import { PrismaClient } from '@prisma/client';
import { createBlockedDeliveryCreationConsumer } from '../../src/modules/deliveries/event-consumer.js';
async function main() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test environment required');
  const [eventId, network, contractId] = process.argv.slice(2);
  if (!eventId || !network || !contractId) throw new Error('Fixture identity required');
  const prisma = new PrismaClient();
  try {
    await createBlockedDeliveryCreationConsumer(prisma, { network, contractId })(eventId);
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
