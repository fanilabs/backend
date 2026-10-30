import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../shared/errors/app-error.js';
import { createUploadEvidenceUseCase } from './upload-evidence.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PDF_MAGIC = Buffer.from('%PDF-1.7');
const MP3_ID3_MAGIC = Buffer.from('ID3');
const MP3_FRAME_MAGIC = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
const MP4_MAGIC = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

function buildDeps() {
  const save = vi.fn(async () => ({ storageKey: 'evidence/key' }));
  return {
    save,
    evidenceRepository: {
      create: vi.fn(async () => ({ id: 'evidence-1' })),
    },
  };
}

function buildInput(contentType: string, content: Buffer) {
  return {
    disputeId: 'dispute-1',
    uploaderId: 'user-1',
    contentType,
    content,
  };
}

describe('createUploadEvidenceUseCase magic byte validation', () => {
  it('accepts a valid PNG with image/png', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps as never);

    await expect(
      useCase(buildInput('image/png', Buffer.concat([PNG_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it('accepts a valid JPEG with image/jpeg', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps as never);

    await expect(
      useCase(buildInput('image/jpeg', Buffer.concat([JPEG_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it('accepts a valid PDF with application/pdf', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps as never);

    await expect(
      useCase(buildInput('application/pdf', Buffer.concat([PDF_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it('accepts MP3 files with ID3 and frame sync magic bytes', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps as never);

    await expect(
      useCase(buildInput('audio/mpeg', Buffer.concat([MP3_ID3_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
    await expect(
      useCase(buildInput('audio/mpeg', Buffer.concat([MP3_FRAME_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
  });

  it('accepts MP4 files with ftyp magic bytes', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps as never);

    await expect(
      useCase(buildInput('video/mp4', Buffer.concat([MP4_MAGIC, Buffer.from('payload')]))),
    ).resolves.toBeDefined();
    expect(deps.save).toHaveBeenCalledOnce();
  });

  it('rejects plain text declared as image/png', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps as never);

    await expect(
      useCase(buildInput('image/png', Buffer.from('this is not a png'))),
    ).rejects.toThrow(ValidationError);
    await expect(
      useCase(buildInput('image/png', Buffer.from('this is not a png'))),
    ).rejects.toThrow('File content does not match declared contentType');
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('rejects an executable declared as image/jpeg', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps as never);

    await expect(
      useCase(buildInput('image/jpeg', Buffer.from('MZ\x90\x00\x03\x00\x00\x00'))),
    ).rejects.toThrow('File content does not match declared contentType');
    expect(deps.save).not.toHaveBeenCalled();
  });

  it('rejects a PNG declared as application/pdf', async () => {
    const deps = buildDeps();
    const useCase = createUploadEvidenceUseCase(deps as never);

    await expect(
      useCase(buildInput('application/pdf', Buffer.concat([PNG_MAGIC, Buffer.from('payload')]))),
    ).rejects.toThrow('File content does not match declared contentType');
    expect(deps.save).not.toHaveBeenCalled();
  });
});
