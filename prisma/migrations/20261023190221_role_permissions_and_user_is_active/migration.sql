/*
  Warnings:

  - You are about to drop the column `description` on the `roles` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "roles" DROP COLUMN "description",
ADD COLUMN     "role_permissions" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;
