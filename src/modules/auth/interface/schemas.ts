import { z } from 'zod';

const email = z.string().trim().toLowerCase().email();
// bcrypt truncates silently beyond 72 *bytes* (not characters — see the
// bcrypt package README). Zod's `.max()` counts UTF-16 code units, so a
// password with multi-byte UTF-8 characters (emoji, many non-Latin scripts)
// can sit under a 72-character limit while still exceeding 72 bytes and
// being silently truncated. Enforce the real byte boundary instead.
const password = z
  .string()
  .min(8)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, {
    message: 'Password must be at most 72 bytes long',
  });

export const registerBodySchema = z.object({
  email,
  password,
});
export const registerResponseSchema = z.object({
  data: z.object({ userId: z.string().uuid() }),
});

export const loginBodySchema = z.object({
  email,
  password: z.string().min(1),
});
export const loginResponseSchema = z.object({
  data: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    user: z.object({
      id: z.string().uuid(),
      email: z.string(),
      role: z.string(),
      emailVerifiedAt: z.string().datetime().nullable(),
    }),
  }),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});
export const refreshResponseSchema = z.object({
  data: z.object({ accessToken: z.string(), refreshToken: z.string() }),
});

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const verifyEmailBodySchema = z.object({
  token: z.string().min(1),
});

export const requestPasswordResetBodySchema = z.object({
  email,
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(1),
  newPassword: password,
});

export const emptyDataResponseSchema = z.object({
  data: z.object({}),
});
