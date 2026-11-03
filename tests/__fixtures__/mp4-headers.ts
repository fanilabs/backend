// Synthetic ISO BMFF boxes, not playable videos. Independent hex vectors.
export const ftyp24 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
export const extendedFtyp32 = Buffer.from(
  '000000016674797000000000000000206d7034320000000069736f6d6d703432',
  'hex',
);
export const validMp4Headers = [
  { name: 'isom/iso2, 24-byte box', bytes: ftyp24 },
  {
    name: 'mp41, minimum box without compatible brands',
    bytes: Buffer.from('00000010667479706d70343100000000', 'hex'),
  },
  { name: 'mp42, extended size', bytes: extendedFtyp32 },
  {
    name: 'extended size, minimum box',
    bytes: Buffer.from('000000016674797000000000000000186d70343200000000', 'hex'),
  },
  {
    name: 'size zero extends to EOF',
    bytes: Buffer.from('00000000667479706d7034320000000069736f6d6d703432', 'hex'),
  },
  {
    name: 'ftyp then moov and mdat box sequence',
    bytes: Buffer.concat([ftyp24, Buffer.from('000000086d6f6f760000000c6d64617400010203', 'hex')]),
  },
  { name: 'binary minor version', bytes: Buffer.from('000000106674797069736f6dffffffff', 'hex') },
];
export function withSize(size: number): Buffer {
  const bytes = Buffer.from(ftyp24);
  bytes.writeUInt32BE(size);
  return bytes;
}
export function withExtendedSize(size: bigint): Buffer {
  const bytes = Buffer.from(extendedFtyp32);
  bytes.writeBigUInt64BE(size, 8);
  return bytes;
}
export const invalidMp4Headers = [
  ...Array.from({ length: 24 }, (_, length) => ({
    name: `standard truncated to ${length}`,
    bytes: ftyp24.subarray(0, length),
  })),
  ...Array.from({ length: 32 }, (_, length) => ({
    name: `extended truncated to ${length}`,
    bytes: extendedFtyp32.subarray(0, length),
  })),
  ...[2, 7, 8, 12, 15, 17, 18, 19, 21, 22, 23, 25, 28, 0x18000000, 0xffffffff].map((size) => ({
    name: `invalid standard size ${size}`,
    bytes: withSize(size),
  })),
  ...[0n, 1n, 15n, 16n, 23n, 25n, 31n, 33n, 9007199254740993n, 18446744073709551615n].map(
    (size) => ({ name: `invalid extended size ${size}`, bytes: withExtendedSize(size) }),
  ),
  { name: 'raw ftyp at byte zero', bytes: Buffer.from('ftypisom00000000') },
  {
    name: 'marker in unrelated payload',
    bytes: Buffer.concat([Buffer.from('0000000866726565', 'hex'), ftyp24]),
  },
  {
    name: 'high-bit byte is not ASCII ftyp',
    bytes: Buffer.from('00000018667479f069736f6d0000020069736f6d69736f32', 'hex'),
  },
  {
    name: 'wrong leading box type',
    bytes: Buffer.from('000000186d64617469736f6d0000020069736f6d69736f32', 'hex'),
  },
  {
    name: 'non-printable major brand',
    bytes: Buffer.from('0000001866747970000000000000020069736f6d69736f32', 'hex'),
  },
  {
    name: 'non-printable compatible brand',
    bytes: Buffer.from('000000186674797069736f6d0000020069736f6d69736fff', 'hex'),
  },
];
