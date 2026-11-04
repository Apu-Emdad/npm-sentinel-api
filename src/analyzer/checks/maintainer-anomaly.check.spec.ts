import dayjs from 'dayjs';
import type { CheckInput } from '../analyzer.types.js';
import { maintainerAnomalyCheck } from './maintainer-anomaly.check.js';

const daysAgo = (days: number) => dayjs().subtract(days, 'day').toISOString();

const version = (
  number: string,
  publishedAt: string,
  maintainers = ['alice'],
) => ({
  version: number,
  publishedAt,
  maintainers: maintainers.map((name) => ({ name })),
});

const run = ({
  versions,
  scanned,
  createdAt = '2015-01-01T00:00:00.000Z',
  weeklyDownloads = 50_000 as number | null,
}: {
  versions: ReturnType<typeof version>[];
  scanned: string;
  createdAt?: string;
  weeklyDownloads?: number | null;
}) =>
  maintainerAnomalyCheck.run({
    registryPackage: { name: 'pkg', createdAt, versions },
    registryVersion: versions.find((item) => item.version === scanned),
    files: [],
    weeklyDownloads,
  } as unknown as CheckInput);

const rulesOf = async (input: Parameters<typeof run>[0]) =>
  (await run(input)).map((finding) => finding.details?.rule);

describe('maintainerAnomalyCheck', () => {
  it('finds nothing for a normal release', async () => {
    const findings = await run({
      versions: [
        version('1.0.0', '2024-01-01T00:00:00.000Z'),
        version('1.1.0', '2024-06-01T00:00:00.000Z'),
      ],
      scanned: '1.1.0',
    });

    expect(findings).toEqual([]);
  });

  it('flags a maintainer the previous version did not have', async () => {
    const findings = await run({
      versions: [
        version('1.0.0', '2024-01-01T00:00:00.000Z', ['alice']),
        version('1.1.0', '2024-02-01T00:00:00.000Z', ['alice', 'mallory']),
      ],
      scanned: '1.1.0',
    });

    expect(findings).toEqual([
      {
        checkType: 'maintainer_anomaly',
        severity: 'low',
        summary: 'New maintainer since 1.0.0: mallory',
        evidence: 'mallory',
        details: {
          rule: 'new maintainer',
          previousVersion: '1.0.0',
          added: ['mallory'],
        },
      },
    ]);
  });

  it('compares with the version published just before, not the one listed before', async () => {
    const findings = await run({
      versions: [
        version('2.0.0', '2024-03-01T00:00:00.000Z', ['bob']),
        version('1.0.0', '2024-01-01T00:00:00.000Z', ['alice']),
        version('1.0.1', '2024-02-01T00:00:00.000Z', ['alice']),
      ],
      scanned: '2.0.0',
    });

    expect(findings[0].details).toMatchObject({
      previousVersion: '1.0.1',
      added: ['bob'],
    });
  });

  it('flags a release 2 years after the previous one, but not before', async () => {
    const versions = [
      version('1.0.0', '2020-01-01T00:00:00.000Z'),
      version('1.1.0', '2021-12-30T00:00:00.000Z'),
      version('1.2.0', '2023-12-30T00:00:00.000Z'),
    ];

    expect(await rulesOf({ versions, scanned: '1.1.0' })).toEqual([]);

    const [finding] = await run({ versions, scanned: '1.2.0' });
    expect(finding).toMatchObject({
      severity: 'low',
      summary: 'Published 730 days after the previous version',
      details: { rule: 'long gap', previousVersion: '1.1.0', gapDays: 730 },
    });
  });

  it('finds nothing for the first version', async () => {
    expect(
      await run({
        versions: [version('1.0.0', '2024-01-01T00:00:00.000Z', ['mallory'])],
        scanned: '1.0.0',
      }),
    ).toEqual([]);
  });

  it('flags a new package with few downloads as medium', async () => {
    const findings = await run({
      versions: [version('1.0.0', daysAgo(5))],
      scanned: '1.0.0',
      createdAt: daysAgo(5),
      weeklyDownloads: 12,
    });

    expect(findings).toEqual([
      expect.objectContaining({
        severity: 'medium',
        summary: 'Package is 5 days old with 12 downloads last week',
        details: { rule: 'new and unused', ageDays: 5, weeklyDownloads: 12 },
      }),
    ]);
  });

  it.each([
    ['30 days old', 30, 12],
    ['100 weekly downloads', 5, 100],
  ])('does not flag a package with %s', async (_, ageDays, downloads) => {
    expect(
      await rulesOf({
        versions: [version('1.0.0', daysAgo(ageDays))],
        scanned: '1.0.0',
        createdAt: daysAgo(ageDays),
        weeklyDownloads: downloads,
      }),
    ).toEqual([]);
  });

  it('skips the new and unused rule when downloads are unknown', async () => {
    expect(
      await run({
        versions: [version('1.0.0', daysAgo(5))],
        scanned: '1.0.0',
        createdAt: daysAgo(5),
        weeklyDownloads: null,
      }),
    ).toEqual([]);
  });
});
