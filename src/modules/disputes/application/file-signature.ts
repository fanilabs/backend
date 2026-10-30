import { ValidationError } from '../../../shared/errors/app-error.js';

const MAGIC_BYTE_LENGTH = 16;

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => buffer[index] === byte);
}

function matchesJpeg(buffer: Buffer): boolean {
  return startsWith(buffer, [0xff, 0xd8, 0xff]);
}

function matchesPng(buffer: Buffer): boolean {
  return startsWith(buffer, [0x89, 0x50, 0x4e, 0x47]);
}

function matchesPdf(buffer: Buffer): boolean {
  return startsWith(buffer, [0x25, 0x50, 0x44, 0x46]);
}

function matchesMp3(buffer: Buffer): boolean {
  return startsWith(buffer, [0x49, 0x44, 0x33]) || startsWith(buffer, [0xff, 0xfb]);
}

function matchesMp4(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

const SIGNATURE_CHECKS: Record<string, (buffer: Buffer) => boolean> = {
  'image/jpeg': matchesJpeg,
  'image/png': matchesPng,
  'application/pdf': matchesPdf,
  'audio/mpeg': matchesMp3,
  'audio/mp3': matchesMp3,
  'video/mp4': matchesMp4,
};

export function assertFileSignatureMatchesContentType(buffer: Buffer, contentType: string): void {
  const check = SIGNATURE_CHECKS[contentType];
  if (!check) {
    return;
  }

  const header = buffer.subarray(0, MAGIC_BYTE_LENGTH);
  if (!check(header)) {
    throw new ValidationError('File content does not match declared contentType');
  }
}
