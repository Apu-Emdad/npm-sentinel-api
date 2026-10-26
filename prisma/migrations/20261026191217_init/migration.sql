-- CreateFunction (not expressible in schema.prisma)
-- generate_uid(size) returns a random id of `size` characters from 0-9, a-z, A-Z.
-- pgcrypto's gen_random_bytes gives cryptographically secure randomness.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION generate_uid(size int DEFAULT 10) RETURNS text AS $$
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

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ScanError" AS ENUM ('package_not_found', 'version_not_found', 'tarball_too_large', 'timeout', 'internal_error');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "CheckType" AS ENUM ('install_scripts', 'typosquatting', 'obfuscation', 'maintainer_anomaly', 'suspicious_dependency');

-- CreateEnum
CREATE TYPE "ReviewVerdict" AS ENUM ('malicious', 'benign');

-- CreateTable
CREATE TABLE "roles" (
    "id" BIGSERIAL NOT NULL,
    "uid" TEXT NOT NULL DEFAULT generate_uid(),
    "name" TEXT NOT NULL,
    "role_permissions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "uid" TEXT NOT NULL DEFAULT generate_uid(),
    "user_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role_id" BIGINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" BIGSERIAL NOT NULL,
    "uid" TEXT NOT NULL DEFAULT generate_uid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_versions" (
    "id" BIGSERIAL NOT NULL,
    "uid" TEXT NOT NULL DEFAULT generate_uid(),
    "package_id" BIGINT NOT NULL,
    "version" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "tarball_url" TEXT NOT NULL,
    "integrity" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scans" (
    "id" BIGSERIAL NOT NULL,
    "uid" TEXT NOT NULL DEFAULT generate_uid(),
    "user_id" BIGINT,
    "package_name" TEXT NOT NULL,
    "requested_version" TEXT,
    "package_version_id" BIGINT,
    "status" "ScanStatus" NOT NULL DEFAULT 'queued',
    "risk_score" SMALLINT,
    "risk_level" "RiskLevel",
    "error" "ScanError",
    "metadata_snapshot" JSONB,
    "analyzer_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" BIGSERIAL NOT NULL,
    "uid" TEXT NOT NULL DEFAULT generate_uid(),
    "scan_id" BIGINT NOT NULL,
    "check_type" "CheckType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" BIGSERIAL NOT NULL,
    "uid" TEXT NOT NULL DEFAULT generate_uid(),
    "package_version_id" BIGINT NOT NULL,
    "verdict" "ReviewVerdict" NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "notes" TEXT,
    "reviewed_by" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_uid_key" ON "roles"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_uid_key" ON "users"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "users_user_name_key" ON "users"("user_name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "packages_uid_key" ON "packages"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "packages_name_key" ON "packages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "package_versions_uid_key" ON "package_versions"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "package_versions_package_id_version_key" ON "package_versions"("package_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "scans_uid_key" ON "scans"("uid");

-- CreateIndex
CREATE INDEX "scans_package_version_id_created_at_idx" ON "scans"("package_version_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "scans_user_id_created_at_idx" ON "scans"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "scans_status_idx" ON "scans"("status");

-- CreateIndex
CREATE UNIQUE INDEX "findings_uid_key" ON "findings"("uid");

-- CreateIndex
CREATE INDEX "findings_scan_id_idx" ON "findings"("scan_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_uid_key" ON "reviews"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_package_version_id_source_key" ON "reviews"("package_version_id", "source");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint (not expressible in schema.prisma)
ALTER TABLE "scans" ADD CONSTRAINT "scans_risk_score_check" CHECK ("risk_score" BETWEEN 0 AND 100);
