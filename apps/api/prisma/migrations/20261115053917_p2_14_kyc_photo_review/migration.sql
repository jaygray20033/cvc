-- AlterTable
ALTER TABLE `kyc_documents` ADD COLUMN `imageHash` VARCHAR(64) NULL,
    MODIFY `type` ENUM('CCCD_FRONT', 'CCCD_BACK', 'PORTRAIT', 'BUSINESS_REG', 'AUTHORIZATION') NOT NULL;

-- AlterTable
ALTER TABLE `kyc_events` MODIFY `type` ENUM('SUBMITTED', 'DOCUMENT_UPLOADED', 'APPROVED', 'NEED_MORE', 'REJECTED', 'DOCUMENT_ACCESSED', 'DUPLICATE_FLAGGED', 'CCCD_ACCESSED') NOT NULL;

-- AlterTable
ALTER TABLE `kyc_submissions` ADD COLUMN `cccdHash` VARCHAR(64) NULL,
    ADD COLUMN `cccdNumberEnc` VARCHAR(255) NULL,
    ADD COLUMN `duplicateFlag` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reviewChecklist` JSON NULL;

-- CreateIndex
CREATE INDEX `kyc_documents_imageHash_idx` ON `kyc_documents`(`imageHash`);

-- CreateIndex
CREATE INDEX `kyc_submissions_cccdHash_idx` ON `kyc_submissions`(`cccdHash`);
