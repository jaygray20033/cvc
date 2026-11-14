/*
  Warnings:

  - You are about to drop the column `roles` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `sessions` ADD COLUMN `activeRole` VARCHAR(32) NOT NULL DEFAULT 'buyer';

-- CreateTable
CREATE TABLE `user_roles` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `user_roles_role_idx`(`role`),
    UNIQUE INDEX `user_roles_userId_role_key`(`userId`, `role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: copy each role from the old users.roles JSON into user_roles (P2.9).
-- Must run before the column is dropped.
INSERT INTO `user_roles` (`id`, `userId`, `role`, `createdAt`, `updatedAt`)
SELECT CONCAT(u.`id`, '_', jt.`role`), u.`id`, jt.`role`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `users` u
JOIN JSON_TABLE(u.`roles`, '$[*]' COLUMNS (`role` VARCHAR(32) PATH '$')) AS jt;

-- AlterTable
ALTER TABLE `users` DROP COLUMN `roles`;
