import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.fn();
const createSmtpClientMock = vi.fn(() => ({ send: sendMock }));

vi.mock('../../../shared/smtp/client', () => ({
  createSmtpClient: createSmtpClientMock,
}));

import { SmtpMailer } from './smtp-mailer';

describe('SmtpMailer', () => {
  beforeEach(() => {
    sendMock.mockReset();
    createSmtpClientMock.mockClear();
  });

  it('sends the verification message once to the supplied address', async () => {
    sendMock.mockResolvedValue(undefined);
    const mailer = new SmtpMailer();

    await mailer.sendVerification('recipient@example.com', 'verify-token');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toBe('recipient@example.com');
    expect(message.subject).toBe('Verify your email address');
    expect(message.text).toContain('verify-token');
    expect(message.text).not.toContain('reset-token');
  });

  it('sends the reset message once to the supplied address', async () => {
    sendMock.mockResolvedValue(undefined);
    const mailer = new SmtpMailer();

    await mailer.sendPasswordReset('recipient@example.com', 'reset-token');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const message = sendMock.mock.calls[0][0];
    expect(message.to).toBe('recipient@example.com');
    expect(message.subject).toBe('Reset your password');
    expect(message.text).toContain('reset-token');
    expect(message.text).not.toContain('verify-token');
  });

  it('propagates transport failure from verification delivery', async () => {
    const error = new Error('smtp down');
    sendMock.mockRejectedValue(error);
    const mailer = new SmtpMailer();

    await expect(
      mailer.sendVerification('recipient@example.com', 'verify-token'),
    ).rejects.toBe(error);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('propagates transport failure from reset delivery', async () => {
    const error = new Error('smtp down');
    sendMock.mockRejectedValue(error);
    const mailer = new SmtpMailer();

    await expect(
      mailer.sendPasswordReset('recipient@example.com', 'reset-token'),
    ).rejects.toBe(error);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
