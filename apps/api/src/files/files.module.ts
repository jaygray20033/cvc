import { Module } from '@nestjs/common';

import { S3Service } from '../common/storage/s3.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { VirusScanService } from './virus-scan.service';

// Shared file service (P2.17). AuditService and MailService are global;
// QueueModule (P2.19) imports this module to reach the post-process handler.
@Module({
  controllers: [FilesController],
  providers: [FilesService, VirusScanService, S3Service],
  exports: [FilesService],
})
export class FilesModule {}
