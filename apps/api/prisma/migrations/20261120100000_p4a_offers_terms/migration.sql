-- CreateTable
CREATE TABLE `deal_terms_drafts` (
    `id` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `terms` JSON NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'VND',
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `deal_terms_drafts_roomId_key`(`roomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `deal_terms_confirmations` (
    `id` VARCHAR(191) NOT NULL,
    `draftId` VARCHAR(191) NOT NULL,
    `roomId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(16) NOT NULL,
    `version` INTEGER NOT NULL,
    `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `deal_terms_confirmations_roomId_version_idx`(`roomId`, `version`),
    UNIQUE INDEX `deal_terms_confirmations_draftId_userId_version_key`(`draftId`, `userId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `deal_terms_drafts` ADD CONSTRAINT `deal_terms_drafts_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `deal_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deal_terms_drafts` ADD CONSTRAINT `deal_terms_drafts_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deal_terms_confirmations` ADD CONSTRAINT `deal_terms_confirmations_draftId_fkey` FOREIGN KEY (`draftId`) REFERENCES `deal_terms_drafts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deal_terms_confirmations` ADD CONSTRAINT `deal_terms_confirmations_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `deal_rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `deal_terms_confirmations` ADD CONSTRAINT `deal_terms_confirmations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
