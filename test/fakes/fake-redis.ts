/**
 * In-memory stand-in for the few Redis commands TokenService uses,
 * so tests never need a running Redis. TTLs are accepted but not enforced.
 */
export class FakeRedis {
  readonly store = new Map<string, string>();
  status = 'wait';

  async set(key: string, value: string, ..._ttl: unknown[]): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async unlink(...keys: string[]): Promise<number> {
    return keys.filter((key) => this.store.delete(key)).length;
  }

  async scan(
    _cursor: string,
    _match: 'MATCH',
    pattern: string,
  ): Promise<[string, string[]]> {
    const prefix = pattern.replace(/\*$/, '');
    return ['0', [...this.store.keys()].filter((k) => k.startsWith(prefix))];
  }

  disconnect(): void {}

  async quit(): Promise<'OK'> {
    return 'OK';
  }
}
