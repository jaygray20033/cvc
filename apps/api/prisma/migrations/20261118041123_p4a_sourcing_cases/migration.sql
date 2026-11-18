
-- CreateTable
CREATE TABLE `sourcing_cases` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `sourceProductId` VARCHAR(191) NOT NULL,
    `caseProductId` VARCHAR(191) NOT NULL,
    `publishedById` VARCHAR(191) NOT NULL,
    `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sourcing_cases_orderId_key`(`orderId`),
    UNIQUE INDEX `sourcing_cases_caseProductId_key`(`caseProductId`),
    INDEX `sourcing_cases_sourceProductId_idx`(`sourceProductId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sourcing_cases` ADD CONSTRAINT `sourcing_cases_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_cases` ADD CONSTRAINT `sourcing_cases_sourceProductId_fkey` FOREIGN KEY (`sourceProductId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_cases` ADD CONSTRAINT `sourcing_cases_caseProductId_fkey` FOREIGN KEY (`caseProductId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sourcing_cases` ADD CONSTRAINT `sourcing_cases_publishedById_fkey` FOREIGN KEY (`publishedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
