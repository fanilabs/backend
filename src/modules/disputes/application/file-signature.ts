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

/**
 * Recognizes a complete leading ISO BMFF FileTypeBox (ISO/IEC 14496-12,
 * sections 4.2–4.3). This checks the container header, not video tracks,
 * codecs, later boxes, playability or content safety. No marker scanning.
 */
export function matchesMp4Header(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 16) return false;
  if (bytes[4] !== 0x66 || bytes[5] !== 0x74 || bytes[6] !== 0x79 || bytes[7] !== 0x70) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(0); // ISO fields are big-endian.
  let headerSize = 8;
  let boxSize = size === 0 ? BigInt(bytes.byteLength) : BigInt(size);
  if (size === 1) {
    if (bytes.byteLength < 24) return false;
    headerSize = 16;
    boxSize = view.getBigUint64(8);
  }
  const minimumSize = BigInt(headerSize + 8); // major brand + minor version
  if (boxSize < minimumSize || boxSize > BigInt(bytes.byteLength)) return false;
  if ((boxSize - minimumSize) % 4n !== 0n) return false;

  // Each brand is a printable four-character code. The minor version is
  // binary; skip it. No codec/brand allowlist or whole-file claim is made.
  for (let offset = headerSize; BigInt(offset) < boxSize; offset += 4) {
    if (offset === headerSize + 4) continue;
    for (let index = offset; index < offset + 4; index++) {
      const byte = bytes[index];
      if (byte === undefined || byte < 0x20 || byte > 0x7e) return false;
    }
  }
  return true;
}

const SIGNATURE_CHECKS: Record<string, (buffer: Buffer) => boolean> = {
  'image/jpeg': matchesJpeg,
  'image/png': matchesPng,
  'application/pdf': matchesPdf,
  'audio/mpeg': matchesMp3,
  'audio/mp3': matchesMp3,
};

export function assertFileSignatureMatchesContentType(buffer: Buffer, contentType: string): void {
  if (contentType === 'video/mp4') {
    if (!matchesMp4Header(buffer)) {
      throw new ValidationError('File content does not match declared contentType');
    }
    return;
  }
  const check = SIGNATURE_CHECKS[contentType];
  if (!check) {
    return;
  }

  const header = buffer.subarray(0, MAGIC_BYTE_LENGTH);
  if (!check(header)) {
    throw new ValidationError('File content does not match declared contentType');
  }
}
