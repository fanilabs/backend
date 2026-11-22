import { describe, expect, expectTypeOf, it } from 'vitest';
import { ok } from './response-envelope.js';

describe('ok', () => {
  it('omits meta when called with data alone', () => {
    const response = ok({ id: 'delivery-1' });

    expect(response).toStrictEqual({ data: { id: 'delivery-1' } });
    expect(response).not.toHaveProperty('meta');
    expectTypeOf(response.data).toEqualTypeOf<{ id: string }>();
  });

  it('keeps an explicitly supplied empty meta object', () => {
    expect(ok([], {})).toStrictEqual({ data: [], meta: {} });
  });

  it('preserves the exact pagination metadata type', () => {
    const data = [{ id: 'delivery-1' }];
    const meta: { limit: number; nextCursor: string | null } = { limit: 10, nextCursor: null };
    const response = ok(data, meta);

    expect(response).toStrictEqual({ data, meta });
    expectTypeOf(response.data).toEqualTypeOf<{ id: string }[]>();
    expectTypeOf(response.meta).toEqualTypeOf<{ limit: number; nextCursor: string | null }>();
  });
});
