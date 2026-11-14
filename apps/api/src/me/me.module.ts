import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { TokenService } from '../auth/token.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';

// Multi-role endpoints (P2.9). Prisma is global; TokenService needs JwtModule
// (same secret/TTL setup as the auth module).
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret'),
        signOptions: { expiresIn: config.get<string>('jwt.accessTtl', '15m') },
      }),
    }),
  ],
  controllers: [MeController],
  providers: [MeService, TokenService],
})
export class MeModule {}
