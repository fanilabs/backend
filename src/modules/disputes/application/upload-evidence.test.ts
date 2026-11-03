import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../shared/errors/app-error.js';
import { testAddress } from '../../../shared/testing/addresses.js';
import {
  buildDispute,
  createFakeEvidenceStorage,
  createFakeWalletOwnershipRepository,
  createInMemoryDisputeRepository,
  createInMemoryEvidenceRepository,
} from './__fixtures__/fakes.js';
import type { UploadEvidenceInput } from './upload-evidence.js';
import { createUploadEvidenceUseCase } from './upload-evidence.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PDF_MAGIC = Buffer.from('%PDF-1.7');
const MP3_ID3_MAGIC = Buffer.from('ID3');
const MP3_FRAME_MAGIC = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
// Complete synthetic 24-byte ftyp box: size, type, major brand, version, compatible brands.
const MP4_MAGIC = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');

const uploader = testAddress('upload-magic-owner');

function buildDeps() {
  const disputeRepository = createInMemoryDisputeRepository();
  const evidenceRepository = createInMemoryEvidenceRepository();
  const evidenceStorage = createFakeEvidenceStorage();
  const walletOwnershipRepository = createFakeWalletOwnershipRepository();
  disputeRepository.seed(buildDispute({ chainDeliveryId: 1n, status: 'OPEN' }));
  walletOwnershipRepository.seed('user-1', uploader);
  const save = vi.spyOn(evidenceStorage, 'save');
  vi.spyOn(evidenceRepository, 'create');
  return {
    disputeRepository,
    evidenceRepository,
    evidenceStorage,
    walletOwnershipRepository,
    save,
  };
}

function buildInput(contentType: string, bytes: Buffer): UploadEvidenceInput {
  return { chainDeliveryId: 1n, uploadedBy: uploader, requesterId: 'user-1', contentType, bytes };
}

describe('createUploadEvidenceUseCase magic byte validation', () => {
  it('accepts a valid PNG with image/png', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps);

    await expect(
      useCase(buildInput('image/png', Buffer.concat([PNG_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it('accepts a valid JPEG with image/jpeg', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps);

    await expect(
      useCase(buildInput('image/jpeg', Buffer.concat([JPEG_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it('accepts a valid PDF with application/pdf', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps);

    await expect(
      useCase(buildInput('application/pdf', Buffer.concat([PDF_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it('accepts MP3 files with ID3 and frame sync magic bytes', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps);

    await expect(
      useCase(buildInput('audio/mpeg', Buffer.concat([MP3_ID3_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
    await expect(
      useCase(buildInput('audio/mpeg', Buffer.concat([MP3_FRAME_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
  });

  it('accepts MP4 files with ftyp magic bytes', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps);

    await expect(useCase(buildInput('video/mp4', MP4_MAGIC))).resolves.toBeDefined();
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it('rejects plain text declared as image/png', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps);

    await expect(
      useCase(buildInput('image/png', Buffer.from('this is not a png'))),
    ).rejects.toThrow(ValidationError);
    await expect(
      useCase(buildInput('image/png', Buffer.from('this is not a png'))),
    ).rejects.toThrow('File content does not match declared contentType');
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.evidenceRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an executable declared as image/jpeg', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps);

    await expect(
      useCase(buildInput('image/jpeg', Buffer.from('MZ\x90\x00\x03\x00\x00\x00'))),
    ).rejects.toThrow('File content does not match declared contentType');
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.evidenceRepository.create).not.toHaveBeenCalled();
  });

  it('rejects a PNG declared as application/pdf', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps);

    await expect(
      useCase(buildInput('application/pdf', Buffer.concat([PNG_MAGIC, Buffer.from('payload')]))),
    ).rejects.toThrow('File content does not match declared contentType');
    expect(deps.save).not.toHaveBeenCalled();
    expect(deps.evidenceRepository.create).not.toHaveBeenCalled();
  });
});
