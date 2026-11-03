import { AnalyzerService } from './analyzer.service.js';
import type { Check, CheckInput } from './analyzer.types.js';

const INPUT = {
  registryPackage: { name: 'left-pad' },
  registryVersion: {
    version: '1.3.0',
    publishedAt: '2018-04-01T00:00:00.000Z',
    publishedBy: 'stevemao',
    maintainers: [{ name: 'stevemao' }],
    scripts: { postinstall: 'node setup.js' },
    dependencies: {},
    optionalDependencies: {},
    peerDependencies: {},
    unpackedSize: 1024,
  },
} as unknown as CheckInput;

const fakeCheck = (severity: 'low' | 'medium' | 'high'): Check => ({
  type: 'install_scripts',
  run: vi.fn().mockResolvedValue([
    {
      checkType: 'install_scripts',
      severity,
      summary: 'summary',
      evidence: 'evidence',
    },
  ]),
});

// Swaps the real checks for fake ones, so each test controls the findings.
const createAnalyzer = (checks: Check[]) => {
  const analyzer = new AnalyzerService();
  Object.defineProperty(analyzer, 'checks', { value: checks });
  return analyzer;
};

describe('AnalyzerService', () => {
  it('runs every check with the input and collects the findings', async () => {
    const checks = [fakeCheck('low'), fakeCheck('high')];
    const analyzer = createAnalyzer(checks);

    const result = await analyzer.analyze(INPUT);

    expect(checks[0].run).toHaveBeenCalledWith(INPUT);
    expect(checks[1].run).toHaveBeenCalledWith(INPUT);
    expect(result.findings).toHaveLength(2);
    expect(result.riskScore).toBe(60);
    expect(result.riskLevel).toBe('medium');
  });

  it('scores 0 and low when nothing is found', async () => {
    const analyzer = createAnalyzer([]);

    const result = await analyzer.analyze(INPUT);

    expect(result).toMatchObject({
      findings: [],
      riskScore: 0,
      riskLevel: 'low',
    });
  });

  it.each([
    [['low'], 10, 'low'],
    [['medium', 'low'], 35, 'low'],
    [['medium', 'medium'], 50, 'medium'],
    [['high', 'medium'], 75, 'high'],
    [['high', 'high', 'high'], 100, 'high'],
  ] as const)(
    'scores %j as %i (%s), capped at 100',
    async (severities, score, level) => {
      const analyzer = createAnalyzer(severities.map(fakeCheck));

      const result = await analyzer.analyze(INPUT);

      expect(result.riskScore).toBe(score);
      expect(result.riskLevel).toBe(level);
    },
  );

  it('saves the registry facts the checks saw', async () => {
    const analyzer = createAnalyzer([]);

    const result = await analyzer.analyze(INPUT);

    expect(result.metadataSnapshot).toMatchObject({
      version: '1.3.0',
      publishedBy: 'stevemao',
      scripts: { postinstall: 'node setup.js' },
    });
  });

  it('fails when a check throws', async () => {
    const broken: Check = {
      type: 'install_scripts',
      run: vi.fn().mockRejectedValue(new Error('broken')),
    };
    const analyzer = createAnalyzer([fakeCheck('low'), broken]);

    await expect(analyzer.analyze(INPUT)).rejects.toThrow('broken');
  });
});
