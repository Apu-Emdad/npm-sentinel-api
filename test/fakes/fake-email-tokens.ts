export interface FakeEmailTokenRow {
  id: bigint;
  userId: bigint;
  type: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/**
 * In-memory stand-in for the `prisma.emailToken` queries EmailTokenService makes,
 * so tests never touch a database.
 */
export function createFakeEmailTokens() {
  const rows: FakeEmailTokenRow[] = [];
  let nextId = 1n;

  return {
    rows,
    deleteMany: async ({
      where,
    }: {
      where: { userId: bigint; type: string; usedAt: null };
    }) => {
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        if (
          row.userId === where.userId &&
          row.type === where.type &&
          row.usedAt === null
        ) {
          rows.splice(i, 1);
        }
      }
      return { count: before - rows.length };
    },
    create: async ({
      data,
    }: {
      data: Pick<
        FakeEmailTokenRow,
        'userId' | 'type' | 'tokenHash' | 'expiresAt'
      >;
    }) => {
      const row = {
        ...data,
        id: nextId++,
        usedAt: null,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { tokenHash: string } }) =>
      rows.find((row) => row.tokenHash === where.tokenHash) ?? null,
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: bigint; usedAt: null };
      data: { usedAt: Date };
    }) => {
      const row = rows.find((r) => r.id === where.id && r.usedAt === null);
      if (row) row.usedAt = data.usedAt;
      return { count: row ? 1 : 0 };
    },
  };
}
