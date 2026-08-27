import { z } from 'zod';

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8).max(72); // bcrypt silently truncates beyond 72 bytes

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
