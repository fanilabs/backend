import { describe, expect, it } from 'vitest';

import { smtpSettingsFromEnv } from './settings';

describe('smtpSettingsFromEnv', () => {
  it('returns undefined when host is missing', () => {
    const env = {
      SMTP_FROM: 'sender@example.test',
      SMTP_PORT: '2525',
    };

    expect(smtpSettingsFromEnv(env)).toBeUndefined();
  });

  it('returns undefined when from is missing', () => {
    const env = {
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '2525',
    };

    expect(smtpSettingsFromEnv(env)).toBeUndefined();
  });

  it('returns undefined when both host and from are missing', () => {
    expect(smtpSettingsFromEnv({})).toBeUndefined();
  });

  it('forwards the exact port and optional fields verbatim', () => {
    const env = {
      SMTP_HOST: 'smtp.example.test',
      SMTP_FROM: 'sender@example.test',
      SMTP_PORT: '2525',
      SMTP_USER: 'relay-user',
      SMTP_PASSWORD: 'relay-password',
      SMTP_SECURE: 'true',
      SMTP_REPLY_TO: 'reply@example.test',
    };

    expect(smtpSettingsFromEnv(env)).toEqual({
      host: 'smtp.example.test',
      from: 'sender@example.test',
      port: 2525,
      user: 'relay-user',
      password: 'relay-password',
      secure: true,
      replyTo: 'reply@example.test',
    });
  });

  it('does not fabricate optional settings when they are omitted', () => {
    const env = {
      SMTP_HOST: 'smtp.example.test',
      SMTP_FROM: 'sender@example.test',
    };

    const settings = smtpSettingsFromEnv(env);

    expect(settings).toBeDefined();
    expect(settings).toMatchObject({
      host: 'smtp.example.test',
      from: 'sender@example.test',
    });
    expect(settings?.port).toBeUndefined();
    expect(settings?.user).toBeUndefined();
    expect(settings?.password).toBeUndefined();
    expect(settings?.secure).toBeUndefined();
    expect(settings?.replyTo).toBeUndefined();
  });

  it('does not modify the input object', () => {
    const env = {
      SMTP_HOST: 'smtp.example.test',
      SMTP_FROM: 'sender@example.test',
      SMTP_PORT: '2525',
      SMTP_USER: 'relay-user',
    };
    const snapshot = { ...env };

    smtpSettingsFromEnv(env);

    expect(env).toEqual(snapshot);
  });
});
