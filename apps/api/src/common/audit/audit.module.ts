import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';
import { AuditAdminController } from './audit-admin.controller';

// Append-only audit log (P2.16). Global so any service can log rich domain
// events directly; no update/delete API anywhere.
@Global()
@Module({
  controllers: [AuditAdminController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
