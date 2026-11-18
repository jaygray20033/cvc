import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProductStatus } from '@prisma/client';

import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SearchService } from '../search/search.service';
import type {
  CreateProductInput,
  ProductImagesInput,
  PublishCaseInput,
  ReplaceSpecsInput,
  UpdateProductInput,
  VisibilityInput,
} from './catalog.dto';
import { PublicCatalogService } from './public-catalog.service';

const MAX_IMAGES_PER_PRODUCT = 20;

// Admin product management (P4.1) + publishing completed sourcing cases
// (P4.3). Port of the demo vendor catalog / publishSourcingCase flows.
@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly redis: RedisService,
    private readonly publicCatalog: PublicCatalogService,
  ) {}

  // ------------------------------------------------------------------ create

  async create(actor: AccessPayload, input: CreateProductInput) {
    await this.assertCategory(input.categoryId);
    const product = await this.prisma.product.create({
      data: {
        sku: input.sku,
        name: input.name,
        spec: input.spec,
        moq: input.moq,
        leadTimeDays: input.leadTimeDays,
        priceRef: input.priceRef,
        currency: input.currency ?? 'VND',
        categoryId: input.categoryId,
        specs: input.specs
          ? { create: input.specs.map((spec, index) => ({ ...spec, sortIndex: index })) }
          : undefined,
      },
      include: { category: true, specs: true, images: true },
    });
    await this.indexProduct(product.id);
    await this.publicCatalog.bustCache();
    this.logger.log({ productId: product.id, actor: actor.sub }, 'product created');
    return this.mapAdmin(product);
  }

  // -------------------------------------------------------------------- read

  async list(query: { status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const where = {
      deletedAt: null,
      status: query.status as ProductStatus | undefined,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { category: true, specs: true, images: true },
      }),
    ]);
    return { items: rows.map((row) => this.mapAdmin(row)), page, limit, total };
  }

  async getById(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { category: true, specs: true, images: true },
    });
    if (!product) throw new NotFoundException('Sản phẩm không tồn tại.');
    return this.mapAdmin(product);
  }

  // ------------------------------------------------------------------ update

  async update(id: string, input: UpdateProductInput) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Sản phẩm không tồn tại.');
    if (input.categoryId) await this.assertCategory(input.categoryId);
    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        name: input.name,
        spec: input.spec,
        moq: input.moq,
        leadTimeDays: input.leadTimeDays,
        priceRef: input.priceRef,
        currency: input.currency,
        categoryId: input.categoryId,
      },
      include: { category: true, specs: true, images: true },
    });
    await this.indexProduct(id);
    await this.publicCatalog.bustCache();
    return this.mapAdmin(updated);
  }

  // Soft delete: keep the row (orders/cases reference products) but hide it.
  async softDelete(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Sản phẩm không tồn tại.');
    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
    await this.search.remove('product', id);
    await this.publicCatalog.bustCache();
    return { message: 'Đã xóa sản phẩm.' };
  }

  // Toggle visibility (demo `toggleProduct`): published products show up in
  // the public catalog, drafts/archived ones do not.
  async setVisibility(id: string, input: VisibilityInput) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, publishedAt: true },
    });
    if (!product) throw new NotFoundException('Sản phẩm không tồn tại.');
    await this.prisma.product.update({
      where: { id },
      data: {
        status: input.visible ? 'PUBLISHED' : 'DRAFT',
        publishedAt: input.visible ? (product.publishedAt ?? new Date()) : product.publishedAt,
      },
    });
    // Admin publishing a supplier listing doubles as D12 approval (P4.4).
    if (input.visible) {
      await this.prisma.supplierProduct.updateMany({
        where: { productId: id, approvedAt: null },
        data: { approvedAt: new Date() },
      });
    }
    await this.indexProduct(id);
    await this.publicCatalog.bustCache();
    return { id, visible: input.visible };
  }

  // ------------------------------------------------------------------ images

  async addImages(id: string, input: ProductImagesInput) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, _count: { select: { images: true } } },
    });
    if (!product) throw new NotFoundException('Sản phẩm không tồn tại.');
    const files = await this.validateFiles(input.fileObjectIds);
    if (product._count.images + files.length > MAX_IMAGES_PER_PRODUCT) {
      throw new BadRequestException(`Tối đa ${MAX_IMAGES_PER_PRODUCT} ảnh mỗi sản phẩm.`);
    }
    const base = product._count.images;
    await this.prisma.productImage.createMany({
      data: files.map((file, index) => ({
        productId: id,
        fileObjectId: file.id,
        sortIndex: base + index,
      })),
    });
    await this.indexProduct(id);
    await this.publicCatalog.bustCache();
    return { added: files.length };
  }

  async removeImage(productId: string, imageId: string) {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId },
      select: { id: true },
    });
    if (!image) throw new NotFoundException('Ảnh không tồn tại.');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    await this.publicCatalog.bustCache();
    return { message: 'Đã xóa ảnh.' };
  }

  // ------------------------------------------------------------------- specs

  // Specs are replaced wholesale (key-value pairs, demo `spec` editor).
  async replaceSpecs(id: string, input: ReplaceSpecsInput) {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Sản phẩm không tồn tại.');
    await this.prisma.$transaction([
      this.prisma.productSpec.deleteMany({ where: { productId: id } }),
      this.prisma.productSpec.createMany({
        data: input.specs.map((spec, index) => ({ ...spec, productId: id, sortIndex: index })),
      }),
    ]);
    await this.indexProduct(id);
    await this.publicCatalog.bustCache();
    return { replaced: input.specs.length };
  }

  // ------------------------------------------------------------ sourcing case

  // Publish a completed sourcing order as a public catalog case (P4.3, port
  // of demo `publishSourcingCase`): the case product is a sanitized copy of
  // the source product — no buyer, supplier or price anywhere.
  async publishSourcingCase(orderId: string, input: PublishCaseInput, actor: AccessPayload) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Đơn hàng không tồn tại.');
    if (order.status !== 'COMPLETED') {
      throw new UnprocessableEntityException('Chỉ publish được đơn đã hoàn tất (COMPLETED).');
    }

    // Idempotent publish.
    const existing = await this.prisma.sourcingCase.findUnique({
      where: { orderId },
      include: {
        caseProduct: {
          include: { category: true, specs: true, images: { include: { fileObject: true } } },
        },
      },
    });
    if (existing) return this.publicCatalog.mapCaseProduct(existing.caseProduct);

    const source = await this.prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      include: { images: true, specs: true },
    });
    if (!source) throw new NotFoundException('Sản phẩm gốc không tồn tại.');

    // Copy sku suffix from the order number (demo: CVC-CASE-<order tail>).
    const caseProduct = await this.prisma.$transaction(async (tx) => {
      const copy = await tx.product.create({
        data: {
          sku: `CVC-CASE-${orderId.slice(-8)}`,
          name: input.name,
          spec: input.spec ?? source.spec,
          moq: source.moq,
          leadTimeDays: source.leadTimeDays,
          // No priceRef / supplier: public case items are price-less.
          categoryId: source.categoryId,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          images: {
            create: source.images
              .filter((image) => image.fileObjectId)
              .map((image) => ({
                fileObjectId: image.fileObjectId,
                alt: image.alt,
                sortIndex: image.sortIndex,
              })),
          },
          specs: {
            create: source.specs.map((spec) => ({
              key: spec.key,
              value: spec.value,
              sortIndex: spec.sortIndex,
            })),
          },
        },
        include: { images: true },
      });
      await tx.sourcingCase.create({
        data: {
          orderId,
          sourceProductId: source.id,
          caseProductId: copy.id,
          publishedById: actor.sub,
        },
      });
      return copy;
    });
    await this.indexProduct(caseProduct.id);
    await this.publicCatalog.bustCache();
    this.logger.log({ orderId, caseProductId: caseProduct.id }, 'sourcing case published');
    return { id: caseProduct.id, sku: caseProduct.sku, publishedAt: caseProduct.publishedAt };
  }

  // ----------------------------------------------------------------- helpers

  private async assertCategory(categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!category) throw new NotFoundException('Danh mục không tồn tại.');
    return category;
  }

  // Images must reference confirmed file objects (READY, scan not failed).
  private async validateFiles(fileObjectIds: string[]) {
    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: fileObjectIds } },
      select: { id: true, status: true, scanStatus: true },
    });
    if (files.length !== fileObjectIds.length) {
      throw new BadRequestException('Một số file không tồn tại.');
    }
    for (const file of files) {
      if (file.status !== 'READY') {
        throw new BadRequestException('Ảnh chưa hoàn tất upload (chưa READY).');
      }
      if (file.scanStatus === 'INFECTED' || file.scanStatus === 'ERROR') {
        throw new BadRequestException('Ảnh không qua được quét virus.');
      }
    }
    return files;
  }

  // Search index for a product: title + category name + spec text. Drafts are
  // indexed as 'unpublished' so public search skips them.
  private async indexProduct(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id },
      select: {
        name: true,
        spec: true,
        status: true,
        category: { select: { name: true } },
      },
    });
    if (!product) return;
    await this.search.upsert('product', id, {
      title: product.name,
      keywords: [product.category?.name ?? '', product.spec ?? ''],
      status: product.status === 'PUBLISHED' ? 'published' : 'unpublished',
    });
  }

  private mapAdmin(product: {
    id: string;
    sku: string;
    name: string;
    spec: string | null;
    moq: number;
    leadTimeDays: number | null;
    priceRef: unknown;
    currency: string;
    status: string;
    publishedAt: Date | null;
    deletedAt: Date | null;
    category: { id: string; name: string; slug: string } | null;
    specs: Array<{ key: string; value: string; sortIndex: number }>;
    images: Array<{
      id: string;
      fileObjectId: string | null;
      alt: string | null;
      sortIndex: number;
    }>;
  }) {
    return {
      id: product.id,
      sku: product.sku,
      name: product.name,
      spec: product.spec,
      moq: product.moq,
      leadTimeDays: product.leadTimeDays,
      priceRef: product.priceRef,
      currency: product.currency,
      status: product.status,
      publishedAt: product.publishedAt,
      deletedAt: product.deletedAt,
      category: product.category
        ? { id: product.category.id, name: product.category.name, slug: product.category.slug }
        : null,
      specs: product.specs,
      images: product.images,
    };
  }
}
