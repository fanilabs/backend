import { createServer, type Socket } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSmtpNotificationSender } from '../src/modules/notifications/infrastructure/smtp-notification-sender.js';
import { selectNotificationSender } from '../src/modules/notifications/infrastructure/select-notification-sender.js';
import { createNotificationsBackgroundWorker } from '../src/modules/notifications/index.js';
import { createNotificationsWorker } from '../src/modules/notifications/infrastructure/queue.js';
import * as configModule from '../src/shared/config/index.js';
import { parseEnv } from '../src/shared/config/env.js';
import { buildNotification } from '../src/modules/notifications/application/__fixtures__/fakes.js';

// Only the queue boundary is replaced: the production factory still constructs
// the real repositories, contact lookup, selector, sender and SMTP client.
// Prisma methods return fixture rows without opening a database connection.
vi.mock('../src/modules/notifications/infrastructure/queue.js', () => ({
  createNotificationsWorker: vi.fn(() => ({ close: vi.fn() })),
  createNotificationJobScheduler: vi.fn(),
}));

async function startRelay(rejectRecipient = false) {
  const commands: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let buffer = '';
    let data: string[] | undefined;
    socket.setEncoding('utf8');
    socket.write('220 test.invalid ready\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            messages.push(data.join('\r\n'));
            data = undefined;
            socket.write('250 queued\r\n');
          } else data.push(line);
          continue;
        }
        commands.push(line);
        if (line.startsWith('EHLO')) socket.write('250 test.invalid\r\n');
        else if (line.startsWith('RCPT') && rejectRecipient) socket.write('550 refused\r\n');
        else if (line === 'DATA') {
          data = [];
          socket.write('354 continue\r\n');
        } else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No relay port');
  return {
    settings: { host: '127.0.0.1', port: address.port, from: 'FaniLab <sender@example.invalid>' },
    commands,
    messages,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('SMTP notification composition', () => {
  let relay: Awaited<ReturnType<typeof startRelay>> | undefined;
  afterEach(async () => {
    await relay?.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('constructs the adapter and sends exact recipient, subject and payload text to the relay', async () => {
    relay = await startRelay();
    const sender = createSmtpNotificationSender(relay.settings);
    const payload = { deliveryId: '42', html: '<b>café</b>', nested: { amount: 5 } };
    await sender.send({
      to: 'Driver <driver@example.invalid>',
      type: 'delivery_confirmed',
      payload,
    });
    expect(relay.commands).toContain('MAIL FROM:<sender@example.invalid>');
    expect(relay.commands).toContain('RCPT TO:<driver@example.invalid>');
    expect(relay.messages).toHaveLength(1);
    const raw = relay.messages[0]!;
    expect(raw).toContain('From: FaniLab <sender@example.invalid>\r\n');
    expect(raw).toContain('To: Driver <driver@example.invalid>\r\n');
    expect(raw).toContain('Subject: FaniLab notification: delivery_confirmed\r\n');
    expect(raw).toContain('Content-Type: text/plain; charset=utf-8');
    expect(Buffer.from(raw.split('\r\n\r\n')[1]!, 'base64').toString('utf8')).toBe(
      `delivery_confirmed\n\n${JSON.stringify(payload, null, 2)}\n`,
    );
  });

  it.each(['smtp', 'sendgrid', 'ses'] as const)(
    'sends through the production %s selector',
    async (provider) => {
      relay = await startRelay();
      await selectNotificationSender('production', provider, relay.settings).send({
        to: 'recipient@example.invalid',
        type: 'event',
        payload: {},
      });
      expect(relay.messages).toHaveLength(1);
    },
  );

  it('propagates relay rejection through the adapter', async () => {
    relay = await startRelay(true);
    await expect(
      createSmtpNotificationSender(relay.settings).send({
        to: 'recipient@example.invalid',
        type: 'event',
        payload: {},
      }),
    ).rejects.toThrow(/SMTP reply 550.*refused/);
    expect(relay.messages).toEqual([]);
  });

  it('uses configured CA settings at construction', () => {
    expect(() =>
      createSmtpNotificationSender({
        host: '127.0.0.1',
        port: 1,
        from: 'sender@example.invalid',
        caPath: '/nonexistent/test-smtp-ca.pem',
      }),
    ).toThrow(/ENOENT/);
  });

  it.each([false, true])(
    'production worker preserves send status and error behavior (reject=%s)',
    async (reject) => {
      relay = await startRelay(reject);
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('NOTIFICATION_PROVIDER', 'smtp');
      vi.stubEnv('SMTP_HOST', relay.settings.host);
      vi.stubEnv('SMTP_PORT', String(relay.settings.port));
      vi.stubEnv('SMTP_FROM', relay.settings.from);
      const prisma = new PrismaClient();
      const notification = buildNotification({ userId: 'user-1' });
      vi.spyOn(prisma.notification, 'findUnique').mockResolvedValue({
        ...notification,
        payload: { deliveryId: '42' },
        updatedAt: notification.createdAt,
      });
      vi.spyOn(configModule, 'getConfig').mockReturnValue(parseEnv());
      const findUser = vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
        id: 'user-1',
        email: 'current@example.invalid',
        passwordHash: 'unused',
        role: 'CUSTOMER',
        tokenVersion: 0,
        emailVerifiedAt: null,
        createdAt: notification.createdAt,
        updatedAt: notification.createdAt,
      });
      const update = vi.spyOn(prisma.notification, 'update').mockResolvedValue({
        ...notification,
        payload: { deliveryId: '42' },
        updatedAt: notification.createdAt,
      });
      createNotificationsBackgroundWorker(prisma);
      const send = vi.mocked(createNotificationsWorker).mock.calls.at(-1)![0];
      if (reject) {
        await expect(
          send({ notificationId: notification.id, isFinalAttempt: false }),
        ).rejects.toThrow(/SMTP reply 550/);
        expect(update).not.toHaveBeenCalled();
        await expect(
          send({ notificationId: notification.id, isFinalAttempt: true }),
        ).rejects.toThrow(/SMTP reply 550/);
        expect(update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'FAILED',
              failureReason: expect.stringContaining('SMTP reply 550'),
            }),
          }),
        );
      } else {
        await send({ notificationId: notification.id });
        expect(findUser).toHaveBeenCalledWith({
          where: { id: 'user-1' },
          select: { id: true, email: true },
        });
        expect(relay.commands).toContain('RCPT TO:<current@example.invalid>');
        expect(update).toHaveBeenCalledWith({
          where: { id: notification.id },
          data: { status: 'SENT', sentAt: expect.any(Date) },
        });
      }
      await prisma.$disconnect();
    },
  );
});
