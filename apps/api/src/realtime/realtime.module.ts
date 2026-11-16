import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

// Socket.IO realtime layer (P2.20). Global: any service can push user/room
// events. Membership lives in Redis; the domain modules grant access when a
// deal room is created (P3.4).
@Global()
@Module({
  imports: [
    // Handshake verification uses the same JWT config as the HTTP guards.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret'),
        signOptions: { expiresIn: config.get<string>('jwt.accessTtl', '15m') },
      }),
    }),
  ],
  providers: [RealtimeService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
