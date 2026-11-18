-- AlterTable
ALTER TABLE `sourcing_requests` ADD COLUMN `assignedToId` VARCHAR(191) NULL,
    ADD COLUMN `market` VARCHAR(100) NULL,
    ADD COLUMN `slaDueAt` DATETIME(3) NULL,
    ADD COLUMN `slaRemindedAt` DATETIME(3) NULL,
    MODIFY `status` ENUM('OPEN', 'QUOTED', 'SELECTED', 'CONVERTED', 'EXPIRED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE `sourcing_request_notes` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `body` VARCHAR(2000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sourcing_request_notes_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `sourcing_requests_assignedToId_status_idx` ON `sourcing_requests`(`assignedToId`, `status`);

-- CreateIndex
CREATE INDEX `sourcing_requests_slaDueAt_idx` ON `sourcing_requests`(`slaDueAt`);

-- AddForeignKey
ALTER TABLE `sourcing_requests` ADD CONSTRAINT `sourcing_requests_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_request_notes` ADD CONSTRAINT `sourcing_request_notes_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sourcing_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_request_notes` ADD CONSTRAINT `sourcing_request_notes_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
