/*
  Warnings:

  - Added the required column `expiresAt` to the `idempotency_keys` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable (backfill first so existing rows keep a 24h TTL)
ALTER TABLE `idempotency_keys` ADD COLUMN `expiresAt` DATETIME(3) NULL;
UPDATE `idempotency_keys` SET `expiresAt` = DATE_ADD(`createdAt`, INTERVAL 24 HOUR) WHERE `expiresAt` IS NULL;
ALTER TABLE `idempotency_keys` MODIFY COLUMN `expiresAt` DATETIME(3) NOT NULL;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedById` VARCHAR(64) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `search_documents` (
    `id` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(32) NOT NULL,
    `entityId` VARCHAR(64) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `searchText` VARCHAR(500) NOT NULL,
    `data` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'published',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `search_documents_entityType_status_idx`(`entityType`, `status`),
    UNIQUE INDEX `search_documents_entityType_entityId_key`(`entityType`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `idempotency_keys_expiresAt_idx` ON `idempotency_keys`(`expiresAt`);

-- Fulltext index for search (P2.23). ngram parser handles short Vietnamese
-- syllables ("ao", "mua") that the default parser would drop; text is already
-- diacritics-stripped when written.
ALTER TABLE `search_documents` ADD FULLTEXT INDEX `search_documents_search_text_ft` (`searchText`) WITH PARSER `ngram`;
