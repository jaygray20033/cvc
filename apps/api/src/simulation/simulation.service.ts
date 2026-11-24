import { Role } from '@cvc/shared';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ClaimsService } from '../claims/claims.service';
import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ProductionService } from '../production/production.service';
import { ShipmentsService } from '../shipments/shipments.service';
import type { PumpSimulationInput, SetSimulationInput } from './simulation.dto';

// P4.21 — demo automation (`setAuto`/`pump`). Every method first checks the
// environment: production or ENABLE_SIMULATION=false returns 404 so the
// routes look absent. Pump advances production, shipment stops and claim
// handling only; it never triggers payments, payouts or refunds.
const NOT_FOUND = 'Không tìm thấy.';
const ORDER_NOT_FOUND = 'Đơn hàng không tồn tại.';

interface SimulationActionResult {
  orderId: string;
  actions: string[];
}

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly production: ProductionService,
    private readonly shipments: ShipmentsService,
    private readonly claims: ClaimsService,
  ) {}

  // POST /simulation/orders/:id/auto
  async setAuto(actor: AccessPayload, orderId: string, input: SetSimulationInput) {
    this.assertEnabled();
    const order = await this.loadOrder(orderId);
    const role = await this.resolveOrderRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    if (actor.role === Role.Buyer && role !== 'buyer') {
      throw new ForbiddenException('Chỉ khách của đơn được bật mô phỏng.');
    }
    if (actor.role === Role.Supplier && role !== 'supplier') {
      throw new ForbiddenException('Chỉ nhà cung cấp của đơn được bật mô phỏng.');
    }

    const simulation = await this.prisma.orderSimulation.upsert({
      where: { orderId },
      create: { orderId, enabled: input.enabled },
      update: { enabled: input.enabled },
    });
    return {
      orderId,
      enabled: simulation.enabled,
      lastPumpedAt: simulation.lastPumpedAt,
    };
  }

  // GET /simulation/orders/:id
  async status(actor: AccessPayload, orderId: string) {
    this.assertEnabled();
    const order = await this.loadOrder(orderId);
    const role = await this.resolveOrderRole(order, actor);
    if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
    const simulation = await this.prisma.orderSimulation.findUnique({
      where: { orderId },
      select: { enabled: true, lastPumpedAt: true },
    });
    return {
      orderId,
      enabled: simulation?.enabled ?? false,
      lastPumpedAt: simulation?.lastPumpedAt ?? null,
      orderStatus: order.status,
    };
  }

  // POST /simulation/pump
  async pump(actor: AccessPayload, input: PumpSimulationInput) {
    this.assertEnabled();
    if (input.orderId) {
      const order = await this.loadOrder(input.orderId);
      const role = await this.resolveOrderRole(order, actor);
      if (!role) throw new NotFoundException(ORDER_NOT_FOUND);
      if (actor.role !== Role.Admin && role === 'staff') {
        throw new ForbiddenException('Chỉ quản trị được chạy mô phỏng toàn hệ thống.');
      }
    } else if (actor.role !== Role.Admin) {
      throw new ForbiddenException('Cần chọn đơn khi chạy mô phỏng.');
    }

    const simulations = await this.prisma.orderSimulation.findMany({
      where: { enabled: true, ...(input.orderId ? { orderId: input.orderId } : {}) },
      select: { orderId: true },
    });
    const results: SimulationActionResult[] = [];
    for (const simulation of simulations) {
      const result = await this.pumpOrder(simulation.orderId);
      if (result) results.push(result);
    }
    this.logger.log({ orders: results.length, actor: actor.sub }, 'simulation pumped');
    return {
      pumpedAt: (input.now ?? new Date()).toISOString(),
      orders: results,
    };
  }

  // ---------------------------------------------------------------- helpers

  private assertEnabled(): void {
    const enabled =
      !this.config.get<boolean>('app.isProduction') &&
      this.config.get<boolean>('app.enableSimulation') === true;
    if (!enabled) throw new NotFoundException(NOT_FOUND);
  }

  private async pumpOrder(orderId: string): Promise<SimulationActionResult | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        supplierId: true,
        shipments: {
          where: { status: { not: 'RETURNED' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true },
        },
        claims: {
          where: {
            status: {
              in: ['OPEN', 'TOPUP_PENDING', 'RETURN_SENT'],
            },
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, status: true, resolutionKind: true, topupStage: true },
        },
      },
    });
    if (!order) return null;

    const actions: string[] = [];
    const adminActor = await this.adminActor();
    const supplierActor = await this.supplierActor(order.supplierId);

    if (order.status === 'PRODUCTION' && supplierActor) {
      try {
        await this.production.ready(supplierActor, order.id, {
          fileObjectIds: [],
          note: 'Mô phỏng: nhà cung cấp báo hoàn tất sản xuất.',
        });
        actions.push('production.ready');
      } catch (error) {
        this.logger.warn({ orderId, err: messageOf(error) }, 'simulation production step failed');
      }
    }

    if (order.status === 'SHIPPING' && adminActor) {
      const shipment = order.shipments[0];
      if (shipment && shipment.status !== 'DELIVERED') {
        try {
          await this.shipments.addStop(adminActor, shipment.id, {
            type: 'DELIVERED',
            description: 'Mô phỏng: hàng đã tới nơi.',
          });
          actions.push('shipment.delivered');
        } catch (error) {
          this.logger.warn({ orderId, err: messageOf(error) }, 'simulation shipment step failed');
        }
      }
    }

    for (const claim of order.claims) {
      try {
        if (claim.status === 'OPEN' && adminActor) {
          await this.claims.propose(adminActor, claim.id, {
            kind: 'REFUND',
            note: 'Mô phỏng: CVC đề xuất hoàn tiền hoặc gửi bù.',
          });
          actions.push(`claim.${claim.id}.proposed`);
        } else if (
          claim.status === 'TOPUP_PENDING' &&
          claim.resolutionKind === 'TOPUP' &&
          claim.topupStage < 3 &&
          supplierActor
        ) {
          await this.claims.moveTopup(supplierActor, claim.id, { note: 'Mô phỏng' });
          actions.push(`claim.${claim.id}.topup`);
        } else if (claim.status === 'RETURN_SENT' && adminActor) {
          await this.claims.receiveReturn(adminActor, claim.id, { note: 'Mô phỏng' });
          actions.push(`claim.${claim.id}.return_received`);
        }
      } catch (error) {
        this.logger.warn(
          { orderId, claimId: claim.id, err: messageOf(error) },
          'simulation claim step failed',
        );
      }
    }

    await this.prisma.orderSimulation.update({
      where: { orderId },
      data: { lastPumpedAt: new Date() },
    });
    return { orderId, actions };
  }

  private async loadOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, buyerId: true, supplierId: true },
    });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    return order;
  }

  private async resolveOrderRole(
    order: { buyerId: string; supplierId: string },
    actor: AccessPayload,
  ): Promise<'buyer' | 'supplier' | 'staff' | null> {
    if (order.buyerId === actor.sub) return 'buyer';
    const supplierId = await this.supplierIdFor(actor.sub);
    if (supplierId && supplierId === order.supplierId) return 'supplier';
    if (['admin', 'sales', 'inspector'].includes(actor.role)) return 'staff';
    return null;
  }

  private async supplierIdFor(userId: string): Promise<string | null> {
    const account = await this.prisma.supplierAccount.findUnique({
      where: { userId },
      select: { supplierId: true },
    });
    return account?.supplierId ?? null;
  }

  private async adminActor(): Promise<AccessPayload | null> {
    const row = await this.prisma.userRole.findFirst({
      where: { role: 'admin' },
      orderBy: { userId: 'asc' },
      select: { userId: true, user: { select: { email: true } } },
    });
    if (!row) return null;
    return { sub: row.userId, email: row.user.email, sid: 'simulation', role: Role.Admin };
  }

  private async supplierActor(supplierId: string): Promise<AccessPayload | null> {
    const account = await this.prisma.supplierAccount.findFirst({
      where: { supplierId },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, user: { select: { email: true } } },
    });
    if (!account) return null;
    return {
      sub: account.userId,
      email: account.user.email,
      sid: 'simulation',
      role: Role.Supplier,
    };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
