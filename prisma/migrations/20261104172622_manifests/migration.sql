-- CreateTable
CREATE TABLE "manifests" (
    "id" BIGSERIAL NOT NULL,
    "uid" TEXT NOT NULL DEFAULT generate_uid(),
    "user_id" BIGINT,
    "include_dev" BOOLEAN NOT NULL,
    "skipped" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifest_dependencies" (
    "id" BIGSERIAL NOT NULL,
    "uid" TEXT NOT NULL DEFAULT generate_uid(),
    "manifest_id" BIGINT NOT NULL,
    "scan_id" BIGINT NOT NULL,
    "package_name" TEXT NOT NULL,
    "range" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manifest_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manifests_uid_key" ON "manifests"("uid");

-- CreateIndex
CREATE INDEX "manifests_user_id_created_at_idx" ON "manifests"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "manifest_dependencies_uid_key" ON "manifest_dependencies"("uid");

-- CreateIndex
CREATE INDEX "manifest_dependencies_scan_id_idx" ON "manifest_dependencies"("scan_id");

-- CreateIndex
CREATE UNIQUE INDEX "manifest_dependencies_manifest_id_package_name_key" ON "manifest_dependencies"("manifest_id", "package_name");

-- AddForeignKey
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_dependencies" ADD CONSTRAINT "manifest_dependencies_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "manifests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_dependencies" ADD CONSTRAINT "manifest_dependencies_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
