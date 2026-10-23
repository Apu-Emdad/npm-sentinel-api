-- RenameRoles: user -> USER, admin -> SUPER_ADMIN
UPDATE "roles" SET "name" = 'USER', "updated_at" = CURRENT_TIMESTAMP WHERE "name" = 'user';
UPDATE "roles" SET "name" = 'SUPER_ADMIN', "updated_at" = CURRENT_TIMESTAMP WHERE "name" = 'admin';
