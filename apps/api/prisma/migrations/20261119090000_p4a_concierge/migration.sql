-- AlterTable
ALTER TABLE `sourcing_requests` ADD COLUMN `contactName` VARCHAR(100) NULL,
    ADD COLUMN `contactPhone` VARCHAR(20) NULL,
    ADD COLUMN `referenceProductId` VARCHAR(191) NULL,
    ADD COLUMN `workflow` ENUM('STANDARD', 'CONCIERGE') NOT NULL DEFAULT 'STANDARD';

-- CreateIndex
CREATE INDEX `sourcing_requests_referenceProductId_idx` ON `sourcing_requests`(`referenceProductId`);

-- AddForeignKey
ALTER TABLE `sourcing_requests` ADD CONSTRAINT `sourcing_requests_referenceProductId_fkey` FOREIGN KEY (`referenceProductId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
