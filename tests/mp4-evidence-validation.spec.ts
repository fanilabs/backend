import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  matchesMp4Header,
  assertFileSignatureMatchesContentType,
} from '../src/modules/disputes/application/file-signature.js';
import { createUploadEvidenceUseCase } from '../src/modules/disputes/application/upload-evidence.js';
import { matchesEvidenceMagicBytes } from '../src/modules/disputes/interface/schemas.js';
import {
  buildDispute,
  createFakeEvidenceStorage,
  createFakeWalletOwnershipRepository,
  createInMemoryDisputeRepository,
  createInMemoryEvidenceRepository,
} from '../src/modules/disputes/application/__fixtures__/fakes.js';
import { ValidationError } from '../src/shared/errors/app-error.js';
import { validMp4Headers, invalidMp4Headers, ftyp24 } from './__fixtures__/mp4-headers.js';

function setup() {
  const disputeRepository = createInMemoryDisputeRepository();
  const evidenceRepository = createInMemoryEvidenceRepository();
  const evidenceStorage = createFakeEvidenceStorage();
  const walletOwnershipRepository = createFakeWalletOwnershipRepository();
  const dispute = buildDispute({ chainDeliveryId: 1n, status: 'OPEN' });
  disputeRepository.seed(dispute);
  walletOwnershipRepository.seed('fixture-user', dispute.raisedBy);
  const save = vi.spyOn(evidenceStorage, 'save');
  const create = vi.spyOn(evidenceRepository, 'create');
  const upload = createUploadEvidenceUseCase({
    disputeRepository,
    evidenceRepository,
    evidenceStorage,
    walletOwnershipRepository,
  });
  return {
    save,
    create,
    evidenceRepository,
    evidenceStorage,
    upload,
    input: {
      chainDeliveryId: 1n,
      requesterId: 'fixture-user',
      uploadedBy: dispute.raisedBy,
      contentType: 'video/mp4',
    },
  };
}

it.each(validMp4Headers)(
  'recognizes $name without modifying persisted bytes or hashes',
  async ({ bytes }) => {
    const deps = setup();
    expect(matchesMp4Header(bytes)).toBe(true);
    expect(matchesEvidenceMagicBytes(bytes, 'video/mp4')).toBe(true);
    expect(() => assertFileSignatureMatchesContentType(bytes, 'video/mp4')).not.toThrow();
    const { evidence } = await deps.upload({ ...deps.input, bytes });
    expect(evidence.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(evidence.uploadedByUserId).toBe('fixture-user');
    expect(await deps.evidenceStorage.read(evidence.storageUrl)).toEqual(bytes);
    expect(await deps.evidenceRepository.findById(evidence.id)).toEqual(evidence);
  },
);

it.each(invalidMp4Headers)(
  'rejects $name consistently before any storage or metadata write',
  async ({ bytes }) => {
    const deps = setup();
    expect(matchesMp4Header(bytes)).toBe(false);
    expect(matchesEvidenceMagicBytes(bytes, 'video/mp4')).toBe(false);
    expect(() => assertFileSignatureMatchesContentType(bytes, 'video/mp4')).toThrow(
      ValidationError,
    );
    await expect(deps.upload({ ...deps.input, bytes })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  },
);

it('uses view byteOffset/byteLength rather than the backing allocation', () => {
  const backing = Buffer.concat([Buffer.alloc(19, 0xff), ftyp24, Buffer.alloc(11, 0xff)]);
  const view = backing.subarray(19, 19 + ftyp24.length);
  expect(matchesMp4Header(view)).toBe(true);
  expect(matchesMp4Header(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))).toBe(
    true,
  );
  expect(matchesMp4Header(view.subarray(0, 23))).toBe(false);
  expect(backing.subarray(0, 19)).toEqual(Buffer.alloc(19, 0xff));
});
