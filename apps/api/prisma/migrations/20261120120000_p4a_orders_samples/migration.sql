-- P4.17 — sample tracking: upload/in-transit/revision states, hand-entered
-- carrier + milestones, revision rounds and optional sample fee.
ALTER TABLE `samples`
    MODIFY `status` ENUM('REQUESTED', 'UPLOADED', 'SENT', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'REVISION_REQUESTED', 'APPROVED', 'REJECTED', 'STOPPED') NOT NULL DEFAULT 'REQUESTED',
    ADD COLUMN `uploadedAt` DATETIME(3) NULL,
    ADD COLUMN `carrier` VARCHAR(100) NULL,
    ADD COLUMN `trackingNo` VARCHAR(100) NULL,
    ADD COLUMN `trackingUrl` VARCHAR(500) NULL,
    ADD COLUMN `photoFileObjectId` VARCHAR(191) NULL,
    ADD COLUMN `revisionCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `revisionNote` VARCHAR(1000) NULL,
    ADD COLUMN `feeAmount` DECIMAL(18, 2) NULL,
    ADD COLUMN `feeCurrency` VARCHAR(3) NULL;

CREATE INDEX `samples_photoFileObjectId_idx` ON `samples`(`photoFileObjectId`);

ALTER TABLE `sample_stops`
    ADD COLUMN `type` ENUM('PICKED_UP', 'IN_TRANSIT', 'CUSTOMS', 'DELIVERED', 'OTHER') NOT NULL DEFAULT 'OTHER',
    ADD COLUMN `location` VARCHAR(200) NULL,
    ADD COLUMN `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `enteredById` VARCHAR(191) NULL;

-- Keep the existing sampleId index (the FK uses it) and add the timeline one.
CREATE INDEX `sample_stops_sampleId_occurredAt_idx` ON `sample_stops`(`sampleId`, `occurredAt`);
CREATE INDEX `sample_stops_enteredById_idx` ON `sample_stops`(`enteredById`);

ALTER TABLE `samples` ADD CONSTRAINT `samples_photoFileObjectId_fkey` FOREIGN KEY (`photoFileObjectId`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `sample_stops` ADD CONSTRAINT `sample_stops_enteredById_fkey` FOREIGN KEY (`enteredById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
