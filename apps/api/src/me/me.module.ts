import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { TokenService } from '../auth/token.service';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

// Multi-role endpoints (P2.9) + profile/addresses/bank accounts (P2.11).
// Prisma and MailService are global; TokenService needs JwtModule (same
// secret/TTL setup as the auth module).
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
  controllers: [MeController, ProfileController],
  providers: [MeService, ProfileService, TokenService],
})
export class MeModule {}
