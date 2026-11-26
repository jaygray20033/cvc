import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AUTH_LIMITS } from './auth/auth.constants';
import { AuthModule } from './auth/auth.module';
import { BannersModule } from './banners/banners.module';
import { CatalogModule } from './catalog/catalog.module';
import { ClaimsModule } from './claims/claims.module';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuditModule } from './common/audit/audit.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RetryAfterThrottlerGuard } from './common/guards/throttler.guard';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { buildPinoOptions } from './common/logger/logger.config';
import { MailModule } from './common/mail/mail.module';
import { validateEnv } from './config/env.validation';
import { DealRoomsModule } from './deal-rooms/deal-rooms.module';
import { FilesModule } from './files/files.module';
import { KycModule } from './kyc/kyc.module';
import { MeModule } from './me/me.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductionModule } from './production/production.module';
import { QueueModule } from './queue/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { SamplesModule } from './samples/samples.module';
import { SearchModule } from './search/search.module';
import { SettingsModule } from './settings/settings.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { SimulationModule } from './simulation/simulation.module';
import { SourcingModule } from './sourcing/sourcing.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { WalletModule } from './wallet/wallet.module';

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
    AuditModule,
    AuthModule,
    MeModule,
    KycModule,
    FilesModule,
    NotificationsModule,
    QueueModule,
    RealtimeModule,
    SettingsModule,
    SearchModule,
    CatalogModule,
    SuppliersModule,
    BannersModule,
    SourcingModule,
    DealRoomsModule,
    OrdersModule,
    SamplesModule,
    PaymentsModule,
    ProductionModule,
    ShipmentsModule,
    PayoutsModule,
    ClaimsModule,
    SimulationModule,
    WalletModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: RetryAfterThrottlerGuard },
    // Idempotency first: replays short-circuit below audit (P2.21).
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    // Automatic audit trail for write requests (P2.16).
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
