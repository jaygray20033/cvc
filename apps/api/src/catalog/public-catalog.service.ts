import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SearchService } from '../search/search.service';
import type { ProductQueryInput } from './catalog.dto';

const CACHE_PREFIX = 'catalog:public:';
const CACHE_TTL_MS = 30_000;

type ProductWithRelations = {
  id: string;
  sku: string;
  name: string;
  spec: string | null;
  moq: number;
  leadTimeDays: number | null;
  publishedAt: Date | null;
  category: { id: string; name: string; slug: string } | null;
  images: Array<{
    id: string;
    fileObjectId: string | null;
    alt: string | null;
    sortIndex: number;
    fileObject: { s3Key: string } | null;
  }>;
  specs: Array<{ key: string; value: string; sortIndex: number }>;
};

// Public catalog (P4.2) + published sourcing cases (P4.3). Responses carry a
// strict whitelist: no priceRef, currency or supplier* fields ever leaves the
// service (DoD tests assert this on the raw JSON). Short-lived Redis cache.
@Injectable()
export class PublicCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly redis: RedisService,
  ) {}

  // --------------------------------------------------------------- products

  async list(query: ProductQueryInput) {
    const page = query.page ?? 1;
    const limit = Math.min(50, query.limit ?? 20);
    const key = `${CACHE_PREFIX}list:${query.q ?? ''}:${query.category ?? ''}:${page}:${limit}`;
    return this.cached(key, async () => {
      // Fulltext search (accent-insensitive via searchNormalize) narrows ids.
      let ids: string[] | null = null;
      if (query.q) {
        const hits = await this.search.search(query.q, { entityType: 'product', limit: 200 });
        ids = hits.items.map((hit) => hit.entityId);
        if (ids.length === 0) return { items: [], page, limit, total: 0 };
      }
      const where = {
        status: 'PUBLISHED' as const,
        deletedAt: null,
        ...(ids ? { id: { in: ids } } : {}),
        ...(query.category ? { category: { slug: query.category } } : {}),
      };
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.product.count({ where }),
        this.prisma.product.findMany({
          where,
          orderBy: { publishedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { category: true, specs: true, images: { include: { fileObject: true } } },
        }),
      ]);
      return { items: rows.map((row) => this.mapProduct(row)), page, limit, total };
    });
  }

  async detailBySku(sku: string) {
    const key = `${CACHE_PREFIX}detail:${sku}`;
    return this.cached(key, async () => {
      const product = await this.prisma.product.findFirst({
        where: { sku, status: 'PUBLISHED', deletedAt: null },
        include: { category: true, specs: true, images: { include: { fileObject: true } } },
      });
      if (!product) throw new NotFoundException('Sản phẩm không tồn tại.');
      return this.mapProduct(product);
    });
  }

  async categories() {
    return this.cached(`${CACHE_PREFIX}categories`, async () => {
      const rows = await this.prisma.category.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortIndex: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          sortIndex: true,
          _count: { select: { products: { where: { status: 'PUBLISHED', deletedAt: null } } } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        sortIndex: row.sortIndex,
        productCount: row._count.products,
      }));
    });
  }

  // --------------------------------------------------------- sourcing cases

  async sourcingCases(page = 1, limit = 20) {
    limit = Math.min(50, Math.max(1, limit));
    return this.cached(`${CACHE_PREFIX}cases:${page}:${limit}`, async () => {
      const [total, rows] = await this.prisma.$transaction([
        this.prisma.sourcingCase.count(),
        this.prisma.sourcingCase.findMany({
          orderBy: { publishedAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            caseProduct: {
              include: { category: true, specs: true, images: { include: { fileObject: true } } },
            },
          },
        }),
      ]);
      return {
        items: rows.map((row) => ({
          ...this.mapCaseProduct(row.caseProduct),
          publishedAt: row.publishedAt,
        })),
        page,
        limit,
        total,
      };
    });
  }

  // ----------------------------------------------------------------- helpers

  async bustCache(): Promise<void> {
    await this.redis.deleteByPattern(`${CACHE_PREFIX}*`);
  }

  // Whitelist mapper: the only way product data reaches public responses.
  mapProduct(product: ProductWithRelations) {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      spec: product.spec,
      moq: product.moq,
      leadTimeDays: product.leadTimeDays,
      category: product.category
        ? { id: product.category.id, name: product.category.name, slug: product.category.slug }
        : null,
      images: product.images.map((image) => ({
        id: image.id,
        s3Key: image.fileObject?.s3Key ?? null,
        alt: image.alt,
        sortIndex: image.sortIndex,
      })),
      specs: product.specs.map((spec) => ({ key: spec.key, value: spec.value })),
      publishedAt: product.publishedAt,
    };
  }

  mapCaseProduct(product: {
    id: string;
    sku: string;
    name: string;
    spec: string | null;
    moq: number;
    leadTimeDays: number | null;
    publishedAt: Date | null;
    category: { id: string; name: string; slug: string } | null;
    images: Array<{
      id: string;
      fileObjectId: string | null;
      alt: string | null;
      sortIndex: number;
      fileObject: { s3Key: string } | null;
    }>;
    specs: Array<{ key: string; value: string; sortIndex: number }>;
  }) {
    return this.mapProduct(product as ProductWithRelations);
  }

  // Short-lived cache wrapper: JSON round-trip keeps responses serializable.
  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const hit = await this.redis.get(key);
    if (hit) return JSON.parse(hit) as T;
    const value = await loader();
    await this.redis.setWithTtl(key, JSON.stringify(value), CACHE_TTL_MS);
    return value;
  }
}
