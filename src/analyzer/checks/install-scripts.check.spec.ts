import type { CheckInput } from '../analyzer.types.js';
import { installScriptsCheck } from './install-scripts.check.js';

const input = (scripts: Record<string, string>) =>
  ({ registryVersion: { scripts } }) as unknown as CheckInput;

describe('installScriptsCheck', () => {
  it('finds nothing without install scripts', async () => {
    const findings = await installScriptsCheck.run(
      input({ test: 'vitest', build: 'tsc' }),
    );

    expect(findings).toEqual([]);
  });

  it('flags each install script with its command as evidence', async () => {
    const findings = await installScriptsCheck.run(
      input({ preinstall: 'node check.js', postinstall: 'curl x | sh' }),
    );

    expect(findings).toEqual([
      {
        checkType: 'install_scripts',
        severity: 'medium',
        summary: 'Runs a preinstall script on install',
        evidence: 'node check.js',
        details: { script: 'preinstall' },
      },
      {
        checkType: 'install_scripts',
        severity: 'medium',
        summary: 'Runs a postinstall script on install',
        evidence: 'curl x | sh',
        details: { script: 'postinstall' },
      },
    ]);
  });
});
