import type { CheckInput } from '../analyzer.types.js';
import { obfuscationCheck } from './obfuscation.check.js';

const run = (files: Record<string, string>) =>
  obfuscationCheck.run({
    files: Object.entries(files).map(([path, text]) => ({
      path,
      content: Buffer.from(text),
    })),
  } as unknown as CheckInput);

const rulesOf = async (files: Record<string, string>) =>
  (await run(files)).map((finding) => finding.details?.rule);

// What javascript-obfuscator output looks like.
const OBFUSCATED = `var _0x3f2a=['log','Hello'];(function(_0x1b2c,_0x4d5e){var _0x6f7a=function(_0x8b9c){while(--_0x8b9c){_0x1b2c['push'](_0x1b2c['shift']());}};_0x6f7a(++_0x4d5e);}(_0x3f2a,0x1a3));var _0x2c4e=function(_0x1b2c,_0x4d5e){return _0x3f2a[_0x1b2c-0x0];};console[_0x2c4e('0x0')](_0x2c4e('0x1'));`;

const NORMAL = `const greet = (name) => {\n  console.log('Hello ' + name);\n};\n\nmodule.exports = greet;\n`;

describe('obfuscationCheck', () => {
  it('flags an obfuscated file as high', async () => {
    const findings = await run({ 'index.js': OBFUSCATED });

    expect(findings).toEqual([
      {
        checkType: 'obfuscation',
        severity: 'high',
        summary: 'Code uses obfuscator-style names like _0x1a2b',
        evidence: `index.js: ${OBFUSCATED.slice(4, 124)}`,
        details: {
          rule: 'obfuscator names',
          file: 'index.js',
          matchedFiles: 1,
        },
      },
    ]);
  });

  it('does not flag a normal file', async () => {
    expect(await run({ 'index.js': NORMAL })).toEqual([]);
  });

  it('flags 5 eval or new Function calls as medium, but not 4', async () => {
    const calls = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        i % 2 ? `eval(code${i});` : `new Function(code${i});`,
      ).join('\n');

    const findings = await run({ 'a.js': calls(5) });

    expect(findings[0]).toMatchObject({
      severity: 'medium',
      details: { rule: 'heavy eval' },
    });
    expect(await run({ 'a.js': calls(4) })).toEqual([]);
  });

  it('flags a long encoded string as low', async () => {
    const encoded = `const payload = "${'QUJD'.repeat(60)}";`;

    const findings = await run({ 'a.js': encoded });

    expect(findings[0]).toMatchObject({
      severity: 'low',
      details: { rule: 'encoded string' },
    });
    expect(await run({ 'a.js': `const s = "${'QUJD'.repeat(40)}";` })).toEqual(
      [],
    );
  });

  it('flags a minified source file as low', async () => {
    const minified = 'var a=1;'.repeat(400);

    expect(await rulesOf({ 'lib/index.js': minified })).toEqual([
      'minified source',
    ]);
  });

  it.each([
    'dist/index.js',
    'build/index.js',
    'umd/index.js',
    'lib/index.min.js',
  ])('allows minified code in %s', async (path) => {
    expect(await run({ [path]: 'var a=1;'.repeat(400) })).toEqual([]);
  });

  it('ignores files that are not JavaScript', async () => {
    expect(await run({ 'README.md': OBFUSCATED })).toEqual([]);
  });

  it('makes one finding per rule and counts the matching files', async () => {
    const findings = await run({
      'a.js': OBFUSCATED,
      'b.cjs': OBFUSCATED,
      'c.mjs': NORMAL,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].details).toMatchObject({
      file: 'a.js',
      matchedFiles: 2,
    });
  });
});
