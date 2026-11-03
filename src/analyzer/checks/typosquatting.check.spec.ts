import type { CheckInput } from '../analyzer.types.js';
import { typosquattingCheck } from './typosquatting.check.js';

const run = (name: string) =>
  typosquattingCheck.run({
    registryPackage: { name },
  } as unknown as CheckInput);

describe('typosquattingCheck', () => {
  it('flags lodahs as similar to lodash', async () => {
    expect(await run('lodahs')).toEqual([
      {
        checkType: 'typosquatting',
        severity: 'medium',
        summary: 'Name looks like the popular package "lodash"',
        evidence: 'lodash',
        details: { lookalike: 'lodash', rule: 'one typo' },
      },
    ]);
  });

  it('does not flag a popular package itself', async () => {
    expect(await run('lodash')).toEqual([]);
  });

  it.each([
    ['expres', 'express'],
    ['expresss', 'express'],
    ['axois', 'axios'],
    ['reacct-dom', 'react-dom'],
    ['mongose', 'mongoose'],
  ])('flags %s as one typo from %s', async (name, popular) => {
    const [finding] = await run(name);

    expect(finding.details).toEqual({ lookalike: popular, rule: 'one typo' });
  });

  it.each([
    ['react_dom', 'react-dom'],
    ['reactdom', 'react-dom'],
    ['body.parser', 'body-parser'],
  ])('flags %s as %s with other separators', async (name, popular) => {
    const [finding] = await run(name);

    expect(finding.details).toEqual({ lookalike: popular, rule: 'separators' });
  });

  it.each(['mx', 'wss', 'pgx'])(
    'does not flag the short name %s for one typo',
    async (name) => {
      expect(await run(name)).toEqual([]);
    },
  );

  it.each(['left-pad', 'npm-sentinel', 'my-company-utils'])(
    'does not flag the unrelated name %s',
    async (name) => {
      expect(await run(name)).toEqual([]);
    },
  );

  it('makes at most one finding', async () => {
    expect(await run('react-domm')).toHaveLength(1);
  });
});
