import { readFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { createSecureContext, TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createSmtpClient, type SmtpSettings } from './smtp-client.js';

/**
 * Fake in-process SMTP relay speaking just enough RFC 5321 to exercise the
 * client end to end: EHLO capability negotiation, optional STARTTLS upgrade,
 * AUTH PLAIN/LOGIN, envelope, DATA capture, and QUIT. The TLS material in
 * __fixtures__/ is a test-only CA (CN=FaniLab Test-Only SMTP CA) signing a
 * CN=localhost certificate — never used for anything but these tests.
 */
interface RelayOptions {
  advertiseStarttls?: boolean;
  authMechanisms?: string[];
  rejectRecipient?: boolean;
  /** Writes the initial 220 greeting across several TCP chunks, splitting
   * mid-CRLF (a bare `\r` arrives in one chunk, the `\n` in the next). */
  chunkGreeting?: boolean;
  /** Writes the (multiline) EHLO reply across several TCP chunks instead of
   * one, with a split point that does not land on a line boundary. */
  chunkEhloReply?: boolean;
  /** Destroys the socket partway through writing the greeting, before a
   * complete status line has been sent. */
  closeDuringGreeting?: boolean;
}

/** Writes each string in `chunks` as its own `socket.write` call, yielding
 * an event-loop turn between them so Node delivers them as separate `data`
 * events rather than coalescing them back into one read. */
function writeChunks(socket: Socket | TLSSocket, chunks: string[]): void {
  let index = 0;
  const next = () => {
    if (index >= chunks.length) return;
    socket.write(chunks[index++]!);
    setTimeout(next, 0);
  };
  next();
}

interface Relay {
  port: number;
  messages: string[];
  authAttempts: string[];
  close(): Promise<void>;
}

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url));
}

async function startRelay(options: RelayOptions = {}): Promise<Relay> {
  const messages: string[] = [];
  const authAttempts: string[] = [];
  const secureContext = createSecureContext({
    key: readFileSync(fixturePath('test-only-server-key.pem')),
    cert: readFileSync(fixturePath('test-only-server-cert.pem')),
  });
  const sockets = new Set<Socket>();

  function attach(socket: Socket | TLSSocket): void {
    sockets.add(socket);
    let pending = '';
    socket.setEncoding('utf8');
    socket.on('error', () => {
      /* destroyed mid-conversation by tests — expected */
    });
    socket.on('data', (chunk: string) => {
      pending += chunk;
      let newlineAt = pending.indexOf('\n');
      while (newlineAt !== -1) {
        const line = pending.slice(0, newlineAt).replace(/\r$/, '');
        pending = pending.slice(newlineAt + 1);
        handleLine(socket, line);
        newlineAt = pending.indexOf('\n');
      }
    });
  }

  function handleLine(socket: Socket | TLSSocket, line: string): void {
    const respond = (text: string) => socket.write(`${text}\r\n`);

    if (session.mode === 'data') {
      if (line === '.') {
        messages.push(session.dataBuffer);
        session.dataBuffer = '';
        session.mode = 'command';
        respond('250 2.0.0 Ok: queued');
      } else {
        session.dataBuffer += `${line}\r\n`;
      }
      return;
    }

    if (session.loginStage) {
      const decoded = Buffer.from(line, 'base64').toString('utf8');
      const expected = session.loginStage === 'user' ? 'test-user' : 'test-pass';
      if (decoded !== expected) {
        respond('535 5.7.8 Authentication credentials invalid');
        session.loginStage = null;
        return;
      }
      if (session.loginStage === 'user') {
        session.loginStage = 'password';
        respond('334 UGFzc3dvcmQ6');
      } else {
        session.loginStage = null;
        authAttempts.push('LOGIN');
        respond('235 2.7.0 Authentication successful');
      }
      return;
    }

    const [verb, ...rest] = line.split(' ');
    switch (verb) {
      case 'EHLO': {
        const capabilities = ['250-relay.test.invalid'];
        if (options.advertiseStarttls) capabilities.push('250-STARTTLS');
        if (options.authMechanisms?.length) {
          capabilities.push(`250-AUTH ${options.authMechanisms.join(' ')}`);
        }
        capabilities.push('250 SMTPUTF8');
        const text = `${capabilities.join('\r\n')}\r\n`;
        if (options.chunkEhloReply) {
          // Split off-line-boundary: midway through the capability text,
          // not at a '\r\n' seam, so a correct parser must still recognize
          // each physical line only once its terminating '\n' has arrived.
          const splitAt = Math.floor(text.length / 2);
          writeChunks(socket, [text.slice(0, splitAt), text.slice(splitAt)]);
        } else {
          socket.write(text);
        }
        return;
      }
      case 'STARTTLS': {
        respond('220 2.0.0 Ready to start TLS');
        socket.removeAllListeners('data');
        // Same upgrade pattern smtp-server/nodemailer use: hand the raw
        // socket to a server-side TLSSocket and keep parsing over it.
        attach(new TLSSocket(socket, { isServer: true, secureContext }));
        return;
      }
      case 'AUTH': {
        const mechanism = rest[0];
        if (mechanism === 'PLAIN') {
          authAttempts.push('PLAIN');
          const decoded = Buffer.from(rest[1] ?? '', 'base64').toString('utf8');
          if (decoded === '\0test-user\0test-pass') {
            respond('235 2.7.0 Authentication successful');
          } else {
            respond('535 5.7.8 Authentication credentials invalid');
          }
          return;
        }
        if (mechanism === 'LOGIN') {
          session.loginStage = 'user';
          respond('334 VXNlcm5hbWU6');
          return;
        }
        respond('504 5.5.4 Unrecognized authentication type');
        return;
      }
      case 'MAIL':
        respond('250 2.1.0 Ok');
        return;
      case 'RCPT':
        respond(options.rejectRecipient ? '550 5.1.1 No such user' : '250 2.1.5 Ok');
        return;
      case 'DATA':
        session.mode = 'data';
        respond('354 End data with <CR><LF>.<CR><LF>');
        return;
      case 'QUIT':
        respond('221 2.2.0 Bye');
        socket.end();
        return;
      default:
        respond('502 5.5.2 Command not implemented');
    }
  }

  const session: {
    mode: 'command' | 'data';
    dataBuffer: string;
    loginStage: 'user' | 'password' | null;
  } = { mode: 'command', dataBuffer: '', loginStage: null };

  const server: Server = createServer((socket) => {
    if (options.closeDuringGreeting) {
      socket.write('220 relay.test.invalid ESMTP re');
      setTimeout(() => socket.end(), 0);
      return;
    }
    if (options.chunkGreeting) {
      writeChunks(socket, ['220 relay.test.invalid ESMTP read', 'y\r', '\n']);
    } else {
      socket.write('220 relay.test.invalid ESMTP ready\r\n');
    }
    attach(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('relay did not bind a port');

  return {
    port: address.port,
    messages,
    authAttempts,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('createSmtpClient', () => {
  let relay: Relay | undefined;

  afterEach(async () => {
    await relay?.close();
    relay = undefined;
  });

  function settingsFor(current: Relay, overrides: Partial<SmtpSettings> = {}): SmtpSettings {
    return {
      host: '127.0.0.1',
      port: current.port,
      user: 'test-user',
      password: 'test-pass',
      from: 'FaniLab <no-reply@example.com>',
      ...overrides,
    };
  }

  it('delivers a message over a plain AUTH PLAIN relay', async () => {
    relay = await startRelay({ authMechanisms: ['PLAIN'] });
    const client = createSmtpClient(settingsFor(relay));

    await client.send({
      to: 'user@example.com',
      subject: 'FaniLab email verification',
      text: 'Hello from the relay test',
    });

    expect(relay.messages).toHaveLength(1);
    const raw = relay.messages[0]!;
    expect(raw).toContain('From: FaniLab <no-reply@example.com>');
    expect(raw).toContain('To: user@example.com');
    expect(raw).toContain('Subject: FaniLab email verification');
    const body = raw.split('\r\n\r\n')[1] ?? '';
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe(
      'Hello from the relay test',
    );
    expect(relay.authAttempts).toEqual(['PLAIN']);
  });

  it('upgrades via STARTTLS (verifying the relay certificate against the configured CA) and authenticates with AUTH LOGIN', async () => {
    relay = await startRelay({ advertiseStarttls: true, authMechanisms: ['LOGIN'] });
    const client = createSmtpClient(
      settingsFor(relay, { caPath: fixturePath('test-only-ca.pem') }),
    );

    await client.send({ to: 'user@example.com', subject: 'TLS delivery', text: 'over TLS' });

    // Reaching the captured message at all proves the post-upgrade EHLO +
    // AUTH LOGIN exchange completed against the self-signed test cert.
    expect(relay.messages).toHaveLength(1);
    expect(relay.messages[0]).toContain('Subject: TLS delivery');
    expect(relay.authAttempts).toEqual(['LOGIN']);
  });

  it('rejects with the relay error when the recipient is refused', async () => {
    relay = await startRelay({ rejectRecipient: true });
    const client = createSmtpClient(settingsFor(relay, { user: undefined, password: undefined }));

    await expect(
      client.send({ to: 'nobody@example.com', subject: 'x', text: 'x' }),
    ).rejects.toThrow(/SMTP reply 550/);
  });

  it('sends without AUTH when no credentials are configured', async () => {
    relay = await startRelay();
    const client = createSmtpClient(settingsFor(relay, { user: undefined, password: undefined }));

    await client.send({ to: 'user@example.com', subject: 'anon', text: 'no credentials' });

    expect(relay.messages).toHaveLength(1);
    expect(relay.authAttempts).toEqual([]);
  });

  it('fails clearly when the relay advertises no supported AUTH mechanism', async () => {
    relay = await startRelay({ authMechanisms: ['CRAM-MD5'] });
    const client = createSmtpClient(settingsFor(relay));

    await expect(client.send({ to: 'user@example.com', subject: 'x', text: 'x' })).rejects.toThrow(
      /no supported AUTH mechanism/,
    );
  });

  it('fails before connecting when only one of SMTP_USER/SMTP_PASSWORD is set', async () => {
    const client = createSmtpClient({
      host: '127.0.0.1',
      port: 1,
      user: 'test-user',
      from: 'no-reply@example.com',
    });

    await expect(client.send({ to: 'user@example.com', subject: 'x', text: 'x' })).rejects.toThrow(
      /must be set together/,
    );
  });

  it('fails at construction when the configured CA file does not exist', () => {
    expect(() =>
      createSmtpClient({
        host: '127.0.0.1',
        port: 587,
        from: 'no-reply@example.com',
        caPath: '/nonexistent/smtp-ca.pem',
      }),
    ).toThrow(/ENOENT|no such file/i);
  });

  it('recognizes the greeting only once a reply split mid-CRLF across TCP chunks has fully arrived', async () => {
    relay = await startRelay({ authMechanisms: ['PLAIN'], chunkGreeting: true });
    const client = createSmtpClient(settingsFor(relay));

    await client.send({
      to: 'user@example.com',
      subject: 'split greeting',
      text: 'delivered despite a chunked 220 reply',
    });

    expect(relay.messages).toHaveLength(1);
    expect(relay.messages[0]).toContain('Subject: split greeting');
  });

  it('parses a multiline EHLO reply correctly whether it arrives whole or split off a line boundary', async () => {
    relay = await startRelay({
      advertiseStarttls: true,
      authMechanisms: ['LOGIN'],
      chunkEhloReply: true,
    });
    const client = createSmtpClient(
      settingsFor(relay, { caPath: fixturePath('test-only-ca.pem') }),
    );

    // Success here depends on both the pre-STARTTLS EHLO (STARTTLS keyword)
    // and the post-upgrade EHLO (AUTH LOGIN) being parsed correctly even
    // though the relay split each one's multiline reply mid-text.
    await client.send({ to: 'user@example.com', subject: 'chunked EHLO', text: 'ok' });

    expect(relay.messages).toHaveLength(1);
    expect(relay.authAttempts).toEqual(['LOGIN']);
  });

  it('still parses a multiline EHLO reply when all of its lines arrive concatenated in one chunk', async () => {
    relay = await startRelay({ authMechanisms: ['PLAIN'] });
    const client = createSmtpClient(settingsFor(relay));

    await client.send({ to: 'user@example.com', subject: 'single-chunk EHLO', text: 'ok' });

    expect(relay.messages).toHaveLength(1);
    expect(relay.authAttempts).toEqual(['PLAIN']);
  });

  it('surfaces a clear error instead of hanging when the relay closes during a partial reply', async () => {
    relay = await startRelay({ closeDuringGreeting: true });
    const client = createSmtpClient(settingsFor(relay, { user: undefined, password: undefined }));

    await expect(
      client.send({ to: 'user@example.com', subject: 'x', text: 'x' }),
    ).rejects.toThrow(/SMTP connection closed unexpectedly/);
  });
});
