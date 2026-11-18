-- AlterTable
ALTER TABLE `quotes` ADD COLUMN `deliveryTerms` VARCHAR(500) NULL,
    MODIFY `status` ENUM('SUBMITTED', 'SELECTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN') NOT NULL DEFAULT 'SUBMITTED';

-- AlterTable
ALTER TABLE `sourcing_requests` ADD COLUMN `categoryId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `sourcing_request_invitations` (
    `id` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `supplierId` VARCHAR(191) NOT NULL,
    `invitedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `sourcing_request_invitations_supplierId_idx`(`supplierId`),
    UNIQUE INDEX `sourcing_request_invitations_requestId_supplierId_key`(`requestId`, `supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `sourcing_requests_categoryId_idx` ON `sourcing_requests`(`categoryId`);

-- AddForeignKey
ALTER TABLE `sourcing_requests` ADD CONSTRAINT `sourcing_requests_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_request_invitations` ADD CONSTRAINT `sourcing_request_invitations_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `sourcing_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_request_invitations` ADD CONSTRAINT `sourcing_request_invitations_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_request_invitations` ADD CONSTRAINT `sourcing_request_invitations_invitedById_fkey` FOREIGN KEY (`invitedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
