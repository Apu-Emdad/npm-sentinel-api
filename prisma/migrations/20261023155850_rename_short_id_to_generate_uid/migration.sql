-- RenameFunction: short_id() -> generate_uid()
ALTER FUNCTION short_id(int) RENAME TO generate_uid;

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "uid" SET DEFAULT generate_uid();

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "uid" SET DEFAULT generate_uid();

-- AlterTable
ALTER TABLE "packages" ALTER COLUMN "uid" SET DEFAULT generate_uid();

-- AlterTable
ALTER TABLE "package_versions" ALTER COLUMN "uid" SET DEFAULT generate_uid();

-- AlterTable
ALTER TABLE "scans" ALTER COLUMN "uid" SET DEFAULT generate_uid();

-- AlterTable
ALTER TABLE "findings" ALTER COLUMN "uid" SET DEFAULT generate_uid();

-- AlterTable
ALTER TABLE "reviews" ALTER COLUMN "uid" SET DEFAULT generate_uid();

