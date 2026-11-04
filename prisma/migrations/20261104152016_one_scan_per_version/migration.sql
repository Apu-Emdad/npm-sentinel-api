/*
  Warnings:

  - You are about to drop the column `requested_version` on the `scans` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[package_version_id]` on the table `scans` will be added. If there are existing duplicate values, this will fail.
  - Made the column `package_version_id` on table `scans` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "scans" DROP CONSTRAINT "scans_package_version_id_fkey";

-- DropIndex
DROP INDEX "scans_package_version_id_created_at_idx";

-- AlterTable
ALTER TABLE "scans" DROP COLUMN "requested_version",
ALTER COLUMN "package_version_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "scans_package_version_id_key" ON "scans"("package_version_id");

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
