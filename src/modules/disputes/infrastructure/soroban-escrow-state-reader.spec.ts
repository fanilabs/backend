import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testAddress } from '../../../shared/testing/addresses.js';
import { createSorobanEscrowStateReader } from './soroban-escrow-state-reader.js';

const simulateTransaction = vi.fn();

vi.mock('../../../shared/soroban/simulation.js', () => ({
  simulateTransaction: (...args: unknown[]) => simulateTransaction(...args),
}));

const ESCROW_CONTRACT = testAddress('escrow');

function buildReader() {
  return createSorobanEscrowStateReader({
    escrowContractId: ESCROW_CONTRACT,
    server: {} as never,
    networkPassphrase: 'Test SDF Network ; September 2015',
  });
}

function mockReturnValue(value: unknown) {
  simulateTransaction.mockResolvedValue({ returnValue: value });
}

function unitEnumVariant(name: string) {
  return { switch: () => ({ name }), value: () => undefined };
}

describe('createSorobanEscrowStateReader', () => {
  beforeEach(() => {
    simulateTransaction.mockReset();
  });

  it('requests get_escrow on the configured escrow contract with the bare-u64 argument', async () => {
    mockReturnValue(unitEnumVariant('Locked'));

    await buildReader()(42n);

    expect(simulateTransaction).toHaveBeenCalledTimes(1);
    const [request] = simulateTransaction.mock.calls[0] as [
      { contractId: string; method: string; args: unknown[] },
    ];
    expect(request.contractId).toBe(ESCROW_CONTRACT);
    expect(request.method).toBe('get_escrow');
    expect(request.args).toHaveLength(1);
    expect(request.args[0]).toMatchObject({ value: 42n });
  });

  it.each([
    ['Locked', 'LOCKED'],
    ['Released', 'RELEASED'],
    ['Refunded', 'REFUNDED'],
    ['Paused', 'PAUSED'],
  ])('maps the %s unit-enum variant to %s', async (variant, expected) => {
    mockReturnValue(unitEnumVariant(variant));

    await expect(buildReader()(1n)).resolves.toBe(expected);
  });

  it('rejects when the simulation fails', async () => {
    simulateTransaction.mockRejectedValue(new Error('simulation failed'));

    await expect(buildReader()(1n)).rejects.toThrow('simulation failed');
  });

  it('rejects when the result root is malformed', async () => {
    mockReturnValue(undefined);

    await expect(buildReader()(1n)).rejects.toThrow();
  });

  it('rejects when the enum shape is malformed', async () => {
    mockReturnValue({ switch: () => ({}), value: () => undefined });

    await expect(buildReader()(1n)).rejects.toThrow();
  });

  it('rejects an unknown unit-enum variant rather than inventing a status', async () => {
    mockReturnValue(unitEnumVariant('Cancelled'));

    await expect(buildReader()(1n)).rejects.toThrow();
  });
});
