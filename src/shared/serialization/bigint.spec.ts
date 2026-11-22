import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const installerUrl = new URL('./bigint.ts', import.meta.url).href;

function runInFreshProcess(beforeImport: string, afterImport: string): string {
  return execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict';
        ${beforeImport}
        await import(process.argv[1]);
        ${afterImport}
      `,
      installerUrl,
    ],
    { encoding: 'utf8' },
  );
}

describe('BigInt JSON installer', () => {
  it('serializes nested and negative bigints as decimal strings when no serializer exists', () => {
    const output = runInFreshProcess(
      "assert.equal('toJSON' in BigInt.prototype, false);",
      'console.log(JSON.stringify({ values: [9007199254740993n, { negative: -42n }] }));',
    );

    expect(JSON.parse(output)).toStrictEqual({ values: ['9007199254740993', { negative: '-42' }] });
  });

  it('preserves the identity and behavior of an existing serializer', () => {
    const output = runInFreshProcess(
      `
        const serialize = function () { return 'custom:' + this.toString(); };
        Object.defineProperty(BigInt.prototype, 'toJSON', { value: serialize, configurable: true });
      `,
      `
        assert.equal(BigInt.prototype.toJSON, serialize);
        console.log(JSON.stringify({ value: 42n }));
      `,
    );

    expect(JSON.parse(output)).toStrictEqual({ value: 'custom:42' });
  });
});
