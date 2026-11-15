import { Role } from '@cvc/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../../prisma/prisma.service';
import { AdminGroups } from '../decorators/admin-groups.decorator';
import { Roles } from '../decorators/roles.decorator';
import { AuditService } from './audit.service';

// Read-only audit log API (P2.16). There is deliberately no update/delete:
// rows are immutable and the hash chain (verifyChain) detects tampering.
@ApiTags('admin')
@Controller('admin/audit-logs')
@Roles(Role.Admin)
@AdminGroups('admin_super', 'admin_ops', 'admin_finance', 'admin_support')
export class AuditAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Tra cứu audit log (lọc theo actor/entity/action/thời gian)' })
  async list(@Query() query: Record<string, string | undefined>) {
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50));
    const where = {
      actorId: query.actorId || undefined,
      entityType: query.entityType || undefined,
      entityId: query.entityId || undefined,
      action: query.action ? { contains: query.action } : undefined,
      createdAt: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  @Get('verify')
  @ApiOperation({ summary: 'Kiểm tra tính toàn vẹn chuỗi hash audit log' })
  verify() {
    return this.audit.verifyChain();
  }
}
