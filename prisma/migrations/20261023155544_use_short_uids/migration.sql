-- CreateFunction (not expressible in schema.prisma)
-- short_id(size) returns a random id of `size` characters from 0-9, a-z, A-Z.
-- pgcrypto's gen_random_bytes gives cryptographically secure randomness.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION short_id(size int DEFAULT 10) RETURNS text AS $$
DECLARE
  alphabet text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  bytes bytea := gen_random_bytes(size);
  result text := '';
BEGIN
  FOR i IN 0..size - 1 LOOP
    result := result || substr(alphabet, (get_byte(bytes, i) % 62) + 1, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "uid" SET DEFAULT short_id(),
ALTER COLUMN "uid" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "uid" SET DEFAULT short_id(),
ALTER COLUMN "uid" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "packages" ALTER COLUMN "uid" SET DEFAULT short_id(),
ALTER COLUMN "uid" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "package_versions" ALTER COLUMN "uid" SET DEFAULT short_id(),
ALTER COLUMN "uid" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "scans" ALTER COLUMN "uid" SET DEFAULT short_id(),
ALTER COLUMN "uid" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "findings" ALTER COLUMN "uid" SET DEFAULT short_id(),
ALTER COLUMN "uid" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "reviews" ALTER COLUMN "uid" SET DEFAULT short_id(),
ALTER COLUMN "uid" SET DATA TYPE TEXT;


-- ShortenExistingUids: rows created before this migration (the seeded roles) still hold 36-character UUIDs.
UPDATE "roles" SET "uid" = short_id();
