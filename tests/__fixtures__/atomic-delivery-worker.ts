import { PrismaClient } from '@prisma/client';
import { createAtomicDeliveryStatusConsumer } from '../../src/modules/deliveries/event-consumer.js';
async function main() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test environment required');
  const [eventId, mode] = process.argv.slice(2);
  if (!eventId) throw new Error('Fixture event identity required');
  const prisma = new PrismaClient();
  try {
    await createAtomicDeliveryStatusConsumer(prisma)(eventId);
    if (mode === 'crash-after-commit') process.kill(process.pid, 'SIGKILL');
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
