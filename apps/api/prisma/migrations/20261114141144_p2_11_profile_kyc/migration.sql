-- CreateTable
CREATE TABLE `profiles` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `orgType` ENUM('PERSONAL', 'BUSINESS_HOUSEHOLD', 'COMPANY') NOT NULL DEFAULT 'PERSONAL',
    `displayName` VARCHAR(191) NOT NULL,
    `taxId` VARCHAR(14) NULL,
    `businessRegNo` VARCHAR(20) NULL,
    `representativeName` VARCHAR(191) NULL,
    `address` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `profiles_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `addresses` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(50) NULL,
    `receiverName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `city` VARCHAR(100) NOT NULL,
    `district` VARCHAR(100) NOT NULL,
    `ward` VARCHAR(100) NOT NULL,
    `line` VARCHAR(255) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `addresses_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(100) NOT NULL,
    `holderName` VARCHAR(191) NOT NULL,
    `accountNoEnc` VARCHAR(255) NOT NULL,
    `accountNoLast4` VARCHAR(4) NOT NULL,
    `accountNoHash` VARCHAR(64) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bank_accounts_accountNoHash_key`(`accountNoHash`),
    INDEX `bank_accounts_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_submissions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'NEED_MORE', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `kyc_submissions_userId_status_idx`(`userId`, `status`),
    INDEX `kyc_submissions_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_documents` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `type` ENUM('CCCD_FRONT', 'CCCD_BACK', 'BUSINESS_REG', 'AUTHORIZATION') NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `s3Key` VARCHAR(255) NOT NULL,
    `bucket` VARCHAR(100) NOT NULL,
    `uploadStatus` ENUM('UPLOADING', 'READY') NOT NULL DEFAULT 'UPLOADING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `kyc_documents_submissionId_idx`(`submissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kyc_events` (
    `id` VARCHAR(191) NOT NULL,
    `submissionId` VARCHAR(191) NOT NULL,
    `type` ENUM('SUBMITTED', 'DOCUMENT_UPLOADED', 'APPROVED', 'NEED_MORE', 'REJECTED', 'DOCUMENT_ACCESSED') NOT NULL,
    `actorId` VARCHAR(64) NULL,
    `actorRole` VARCHAR(32) NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `kyc_events_submissionId_createdAt_idx`(`submissionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `profiles` ADD CONSTRAINT `profiles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `addresses` ADD CONSTRAINT `addresses_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_accounts` ADD CONSTRAINT `bank_accounts_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_submissions` ADD CONSTRAINT `kyc_submissions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_documents` ADD CONSTRAINT `kyc_documents_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `kyc_submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kyc_events` ADD CONSTRAINT `kyc_events_submissionId_fkey` FOREIGN KEY (`submissionId`) REFERENCES `kyc_submissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
