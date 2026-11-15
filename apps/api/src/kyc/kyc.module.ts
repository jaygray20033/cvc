import { Module } from '@nestjs/common';

import { S3Service } from '../common/storage/s3.service';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycAdminController } from './kyc-admin.controller';

// KYC document upload + manual review (P2.12/P2.13). Prisma, MailService are
// global; S3Service is provided here (full file service lands in P2.17).
@Module({
  controllers: [KycController, KycAdminController],
  providers: [KycService, S3Service],
})
export class KycModule {}
