-- AlterTable
ALTER TABLE "manifest_dependencies" ADD COLUMN     "is_dev" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "manifests" ADD COLUMN     "name" TEXT;
