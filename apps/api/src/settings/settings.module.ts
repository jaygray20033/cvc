import { Global, Module } from '@nestjs/common';

import { SettingsAdminController } from './settings-admin.controller';
import { SystemSettingsService } from './system-settings.service';

// Runtime configuration (P2.22). Global: services read settings directly.
@Global()
@Module({
  controllers: [SettingsAdminController],
  providers: [SystemSettingsService],
  exports: [SystemSettingsService],
})
export class SettingsModule {}
