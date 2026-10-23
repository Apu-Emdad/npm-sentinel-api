-- AddCheckConstraint (not expressible in schema.prisma)
ALTER TABLE "scans" ADD CONSTRAINT "scans_risk_score_check" CHECK ("risk_score" BETWEEN 0 AND 100);

-- SeedRoles (reference data every environment needs)
INSERT INTO "roles" ("name", "description", "updated_at") VALUES
    ('user', 'Default role for registered users', CURRENT_TIMESTAMP),
    ('admin', 'Full access, including reviews', CURRENT_TIMESTAMP);
