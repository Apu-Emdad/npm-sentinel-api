/**
 * Seed script
 *
 * Creates the first super admin (user name "admin", email "admin@example.com") with a
 * random password, which it prints once. Safe to run again: it does nothing if a user
 * with that user name or email already exists. Run it with `yarn db:seed`.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { ROLE } from '../src/common/constants/roles.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const SUPER_ADMIN_USER_NAME = 'admin';
const SUPER_ADMIN_EMAIL = 'admin@example.com';

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL ?? ''),
  });

  try {
    // 1. skipping when the user already exists
    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ userName: SUPER_ADMIN_USER_NAME }, { email: SUPER_ADMIN_EMAIL }],
      },
      select: { uid: true },
    });

    if (existing) {
      console.log(
        `Super admin seed skipped: "${SUPER_ADMIN_USER_NAME}" or "${SUPER_ADMIN_EMAIL}" exists`,
      );
      return;
    }

    // 2. creating the super admin with a random password (24 characters)
    const password = randomBytes(18).toString('base64url');

    await prisma.user.create({
      data: {
        userName: SUPER_ADMIN_USER_NAME,
        email: SUPER_ADMIN_EMAIL,
        passwordHash: await argon2.hash(password),
        roleInfo: { connect: { name: ROLE.SUPER_ADMIN } },
      },
    });

    // 3. printing the password: it is stored only as a hash, so this is the only time it is shown
    console.log(
      [
        '',
        '=============================================',
        '  Super admin created',
        '',
        `  User name: ${SUPER_ADMIN_USER_NAME}`,
        `  Password:  ${password}`,
        '',
        '  Save this password now. It is shown only once.',
        '=============================================',
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
