import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AUTH_LIMITS } from './auth/auth.constants';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RetryAfterThrottlerGuard } from './common/guards/throttler.guard';
import { buildPinoOptions } from './common/logger/logger.config';
import { MailModule } from './common/mail/mail.module';
import { validateEnv } from './config/env.validation';
import { MeModule } from './me/me.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // Global rate limiting backed by Redis (P2.6). Only ONE named throttler
    // ("default") is registered: in @nestjs/throttler v6 every registered
    // named throttler applies to every route, so route-specific limits are
    // done with @Throttle({ default: {...} }) overrides on the auth routes
    // instead of extra named throttlers.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [{ name: 'default', ...AUTH_LIMITS.throttleDefault }],
        storage: new ThrottlerStorageRedisService(
          config.get<string>('redis.url', 'redis://localhost:6379'),
        ),
      }),
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: buildPinoOptions(config.get<string>('app.nodeEnv', 'development')),
      }),
    }),
    PrismaModule,
    RedisModule,
    MailModule,
    AuthModule,
    MeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: RetryAfterThrottlerGuard },
  ],
})
export class AppModule {}
