import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import type {
  CreatePartnerBannerInput,
  PartnerBannerQueryInput,
  UpdatePartnerBannerInput,
} from './banners.dto';

const CACHE_PREFIX = 'banners:public:';
const CACHE_TTL_MS = 30_000;

// P4.6 — partner banners (sponsored suppliers / shipping services). Admin CRUD
// plus a public feed that only returns banners whose display window is open
// (DoD: expired banners disappear on their own).
@Injectable()
export class BannersService {
  private readonly logger = new Logger(BannersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---------------------------------------------------------------- admin

  async create(actor: AccessPayload, input: CreatePartnerBannerInput) {
    this.assertWindow(input.startsAt, input.endsAt);
    if (input.logoFileObjectId) await this.validateLogo(input.logoFileObjectId);
    const banner = await this.prisma.partnerBanner.create({
      data: {
        partnerType: input.partnerType,
        name: input.name,
        logoFileObjectId: input.logoFileObjectId,
        linkUrl: input.linkUrl,
        position: input.position,
        isActive: input.isActive ?? true,
        sortIndex: input.sortIndex ?? 0,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
    });
    await this.bustCache();
    this.logger.log({ bannerId: banner.id, actor: actor.sub }, 'partner banner created');
    return this.mapAdmin(banner);
  }

  async listAdmin(query: PartnerBannerQueryInput) {
    const rows = await this.prisma.partnerBanner.findMany({
      where: {
        partnerType: query.partnerType,
        position: query.position,
      },
      orderBy: [{ sortIndex: 'asc' }, { createdAt: 'desc' }],
    });
    return { items: rows.map((row) => this.mapAdmin(row)) };
  }

  async getById(id: string) {
    const banner = await this.prisma.partnerBanner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner không tồn tại.');
    return this.mapAdmin(banner);
  }

  async update(id: string, input: UpdatePartnerBannerInput) {
    const banner = await this.prisma.partnerBanner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner không tồn tại.');
    const startsAt = input.startsAt ?? banner.startsAt;
    const endsAt = input.endsAt ?? banner.endsAt;
    this.assertWindow(startsAt, endsAt);
    if (input.logoFileObjectId) await this.validateLogo(input.logoFileObjectId);
    const updated = await this.prisma.partnerBanner.update({
      where: { id },
      data: {
        partnerType: input.partnerType,
        name: input.name,
        logoFileObjectId: input.logoFileObjectId,
        linkUrl: input.linkUrl,
        position: input.position,
        isActive: input.isActive,
        sortIndex: input.sortIndex,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      },
    });
    await this.bustCache();
    return this.mapAdmin(updated);
  }

  async remove(id: string) {
    const banner = await this.prisma.partnerBanner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner không tồn tại.');
    // Hard delete: nothing references banners.
    await this.prisma.partnerBanner.delete({ where: { id } });
    await this.bustCache();
    return { message: 'Đã xóa banner.' };
  }

  // --------------------------------------------------------------- public

  async listPublic(query: PartnerBannerQueryInput) {
    const key = `${CACHE_PREFIX}${query.partnerType ?? 'all'}:${query.position ?? 'all'}`;
    const hit = await this.redis.get(key);
    if (hit) return JSON.parse(hit) as unknown;

    const now = new Date();
    const rows = await this.prisma.partnerBanner.findMany({
      where: {
        partnerType: query.partnerType,
        position: query.position,
        isActive: true,
        // Display window: null sides are unbounded (DoD: expired auto-hide).
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ sortIndex: 'asc' }, { createdAt: 'desc' }],
      include: { logoFile: { select: { id: true, s3Key: true } } },
    });
    const items = rows.map((row) => ({
      id: row.id,
      partnerType: row.partnerType,
      name: row.name,
      logo: row.logoFile ? { id: row.logoFile.id, s3Key: row.logoFile.s3Key } : null,
      linkUrl: row.linkUrl,
      position: row.position,
      sortIndex: row.sortIndex,
    }));
    await this.redis.setWithTtl(key, JSON.stringify({ items }), CACHE_TTL_MS);
    return { items };
  }

  // --------------------------------------------------------------- helpers

  private async bustCache(): Promise<void> {
    await this.redis.deleteByPattern(`${CACHE_PREFIX}*`);
  }

  private assertWindow(startsAt?: Date | null, endsAt?: Date | null): void {
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('Thời điểm kết thúc phải sau thời điểm bắt đầu.');
    }
  }

  // Same file rule as product images: READY and not virus-flagged.
  private async validateLogo(fileObjectId: string): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileObjectId },
      select: { status: true, scanStatus: true },
    });
    if (!file) throw new BadRequestException('File logo không tồn tại.');
    if (file.status !== 'READY') {
      throw new BadRequestException('Logo chưa hoàn tất upload (chưa READY).');
    }
    if (file.scanStatus === 'INFECTED' || file.scanStatus === 'ERROR') {
      throw new BadRequestException('Logo không qua được quét virus.');
    }
  }

  private mapAdmin(banner: {
    id: string;
    partnerType: string;
    name: string;
    logoFileObjectId: string | null;
    linkUrl: string | null;
    position: string;
    isActive: boolean;
    sortIndex: number;
    startsAt: Date | null;
    endsAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: banner.id,
      partnerType: banner.partnerType,
      name: banner.name,
      logoFileObjectId: banner.logoFileObjectId,
      linkUrl: banner.linkUrl,
      position: banner.position,
      isActive: banner.isActive,
      sortIndex: banner.sortIndex,
      startsAt: banner.startsAt,
      endsAt: banner.endsAt,
      createdAt: banner.createdAt,
      updatedAt: banner.updatedAt,
    };
  }
}
