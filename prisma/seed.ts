/**
 * Seed script
 *
 * Creates the first super admin from SUPER_ADMIN_USER_NAME, SUPER_ADMIN_EMAIL and
 * SUPER_ADMIN_PASSWORD in .env. Safe to run again: it does nothing if a user with
 * that user name or email already exists. Run it with `yarn db:seed`.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { ROLE } from '../src/common/constants/roles.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

async function main() {
  // 1. reading and checking the env values (same rules as register)
  const userName = process.env.SUPER_ADMIN_USER_NAME?.trim().toLowerCase();
  const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!userName || !email || !password) {
    throw new Error(
      'Set SUPER_ADMIN_USER_NAME, SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env',
    );
  }
  if (!/^[a-z0-9_-]{3,30}$/.test(userName)) {
    throw new Error(
      'SUPER_ADMIN_USER_NAME must be 3 to 30 characters: a-z, 0-9, _ and -',
    );
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error('SUPER_ADMIN_PASSWORD must be 8 to 128 characters');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL ?? ''),
  });

  try {
    // 2. skipping when the user already exists
    const existing = await prisma.user.findFirst({
      where: { OR: [{ userName }, { email }] },
      select: { uid: true },
    });

    if (existing) {
      console.log(
        `Super admin seed skipped: "${userName}" or "${email}" exists`,
      );
      return;
    }

    // 3. creating the super admin
    await prisma.user.create({
      data: {
        userName,
        email,
        passwordHash: await argon2.hash(password),
        roleInfo: { connect: { name: ROLE.SUPER_ADMIN } },
      },
    });

    console.log(`Super admin "${userName}" created`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
