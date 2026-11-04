import dayjs from 'dayjs';
import type { CheckInput, DependencyStats } from '../analyzer.types.js';
import {
  getUnknownDependencies,
  suspiciousDependencyCheck,
} from './suspicious-dependency.check.js';

const daysAgo = (days: number) => dayjs().subtract(days, 'day').toISOString();

const versionWith = (
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string> = {},
) => ({ dependencies, optionalDependencies, devDependencies: {} });

const run = (
  dependencies: Record<string, string>,
  dependencyStats: DependencyStats[] = [],
) =>
  suspiciousDependencyCheck.run({
    registryVersion: versionWith(dependencies),
    dependencyStats,
  } as unknown as CheckInput);

const rulesOf = async (dependencies: Record<string, string>) =>
  (await run(dependencies)).map((finding) => finding.details?.rule);

describe('suspiciousDependencyCheck', () => {
  it('finds nothing for normal registry dependencies', async () => {
    expect(
      await run({ lodash: '^4.17.21', react: '18.x', debug: 'latest' }),
    ).toEqual([]);
  });

  it('flags a URL dependency as high', async () => {
    const findings = await run({
      lodash: '^4.17.21',
      helper: 'https://evil.example.com/helper.tgz',
    });

    expect(findings).toEqual([
      {
        checkType: 'suspicious_dependency',
        severity: 'high',
        summary: 'Installs dependencies from a URL: helper',
        evidence: 'helper: https://evil.example.com/helper.tgz',
        details: {
          rule: 'url dependency',
          dependencies: { helper: 'https://evil.example.com/helper.tgz' },
        },
      },
    ]);
  });

  it.each([
    'git+https://github.com/user/repo.git',
    'git://github.com/user/repo.git',
    'github:user/repo',
    'gitlab:user/repo',
    'user/repo',
    'user/repo#v1.0.0',
  ])('flags the git dependency %s as medium', async (spec) => {
    const [finding] = await run({ helper: spec });

    expect(finding).toMatchObject({
      severity: 'medium',
      details: { rule: 'git dependency' },
    });
  });

  it.each(['file:../helper', 'link:../helper', './helper.tgz', '../helper'])(
    'flags the local dependency %s as low',
    async (spec) => {
      const [finding] = await run({ helper: spec });

      expect(finding).toMatchObject({
        severity: 'low',
        details: { rule: 'local dependency' },
      });
    },
  );

  it.each(['optionalDependencies', 'peerDependencies'])(
    'checks %s too',
    async (field) => {
      const findings = await suspiciousDependencyCheck.run({
        registryVersion: {
          ...versionWith({}),
          [field]: { helper: 'https://evil.example.com' },
        },
        dependencyStats: [],
      } as unknown as CheckInput);

      expect(findings[0].details?.rule).toBe('url dependency');
    },
  );

  it('makes one finding per rule, listing every match', async () => {
    const findings = await run({
      a: 'https://one.example.com/a.tgz',
      b: 'http://two.example.com/b.tgz',
      c: 'github:user/c',
    });

    expect(findings).toHaveLength(2);
    expect(findings[0].details?.dependencies).toEqual({
      a: 'https://one.example.com/a.tgz',
      b: 'http://two.example.com/b.tgz',
    });
  });

  it('flags a dependency that looks like a popular package as medium', async () => {
    const findings = await run({ lodahs: '^1.0.0' });

    expect(findings).toEqual([
      {
        checkType: 'suspicious_dependency',
        severity: 'medium',
        summary: 'Depends on packages that look like popular ones: lodahs',
        evidence: 'lodahs looks like lodash',
        details: {
          rule: 'typosquat dependency',
          dependencies: [
            { name: 'lodahs', lookalike: 'lodash', rule: 'one typo' },
          ],
        },
      },
    ]);
  });

  it('checks the real name behind an npm alias', async () => {
    const findings = await run({ lodash: 'npm:lodahs@1.0.0' });

    expect(findings[0].details?.dependencies).toMatchObject([
      { name: 'lodahs', lookalike: 'lodash' },
    ]);
  });

  it('does not check typos on URL or git dependencies', async () => {
    expect(await rulesOf({ lodahs: 'github:user/lodahs' })).toEqual([
      'git dependency',
    ]);
  });

  it('flags a dependency under 30 days old with under 100 downloads as medium', async () => {
    const findings = await run({ helper: '^1.0.0' }, [
      { name: 'helper', createdAt: daysAgo(3), weeklyDownloads: 12 },
    ]);

    expect(findings).toEqual([
      {
        checkType: 'suspicious_dependency',
        severity: 'medium',
        summary:
          'Depends on very new packages with almost no downloads: helper',
        evidence: 'helper: 3 days old, 12 downloads last week',
        details: {
          rule: 'new and unused dependency',
          dependencies: [{ name: 'helper', ageDays: 3, weeklyDownloads: 12 }],
        },
      },
    ]);
  });

  it.each([
    ['30 days old', { createdAt: daysAgo(30), weeklyDownloads: 12 }],
    ['100 downloads', { createdAt: daysAgo(3), weeklyDownloads: 100 }],
    ['no download stats', { createdAt: daysAgo(3), weeklyDownloads: null }],
    ['no creation date', { createdAt: null, weeklyDownloads: 12 }],
  ])('does not flag a dependency with %s', async (_, stats) => {
    expect(
      await run({ helper: '^1.0.0' }, [{ name: 'helper', ...stats }]),
    ).toEqual([]);
  });
});

describe('getUnknownDependencies', () => {
  it('returns registry dependencies that are not well-known', () => {
    const names = getUnknownDependencies(
      versionWith(
        {
          lodash: '^4.17.21',
          'my-private-helper': '^1.0.0',
          alias: 'npm:@acme/real-helper@^2.0.0',
          remote: 'https://evil.example.com/remote.tgz',
        },
        { 'my-optional-helper': '^1.0.0' },
      ) as never,
    );

    expect(names).toEqual([
      'my-private-helper',
      '@acme/real-helper',
      'my-optional-helper',
    ]);
  });

  it('looks up at most 20 dependencies', () => {
    const dependencies = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [`my-helper-${i}`, '^1.0.0']),
    );

    expect(
      getUnknownDependencies(versionWith(dependencies) as never),
    ).toHaveLength(20);
  });
});
