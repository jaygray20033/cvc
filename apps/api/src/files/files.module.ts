import { Module } from '@nestjs/common';

import { S3Service } from '../common/storage/s3.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { VirusScanService } from './virus-scan.service';

// Shared file service (P2.17). AuditService and MailService are global;
// BullMQ queues land in P2.19 (scan/thumbnail run in-process until then).
@Module({
  controllers: [FilesController],
  providers: [FilesService, VirusScanService, S3Service],
})
export class FilesModule {}
