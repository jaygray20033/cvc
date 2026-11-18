import { Module } from '@nestjs/common';

import { AdminBannersController } from './admin-banners.controller';
import { BannersService } from './banners.service';
import { PublicBannersController } from './public-banners.controller';

// Partner banners (P4.6). PrismaModule/RedisModule are global.
@Module({
  controllers: [AdminBannersController, PublicBannersController],
  providers: [BannersService],
})
export class BannersModule {}
