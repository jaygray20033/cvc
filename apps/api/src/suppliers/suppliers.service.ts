import { createHash, randomBytes } from 'node:crypto';

import { Role } from '@cvc/shared';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductStatus } from '@prisma/client';

import { AUTH_LIMITS } from '../auth/auth.constants';
import { PublicCatalogService } from '../catalog/public-catalog.service';
import type { AccessPayload } from '../common/decorators/current-user.decorator';
import { MailService } from '../common/mail/mail.service';
import { resetPasswordHtml, resetPasswordText } from '../common/mail/mail.templates';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import type {
  CreateSupplierAccountInput,
  CreateSupplierInput,
  SupplierAccountStatusInput,
  SupplierProductInput,
  SupplierProductVisibilityInput,
  UpdateSupplierProductInput,
} from './suppliers.dto';

// P4.4 supplier portal (own listings only) + P4.5 admin supplier accounts
// (create with invite email, lock/unlock). Port of demo `ownProducts`,
// `saveProduct`, `createAccount`, `toggleAccount`.
@Injectable()
export class SuppliersService {
  private readonly logger = new Logger(SuppliersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly publicCatalog: PublicCatalogService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------- supplier portal (P4.4)

  async listOwn(userId: string, page = 1, limit = 20) {
    const supplierId = await this.resolveSupplierId(userId);
    limit = Math.min(50, Math.max(1, limit));
    const where = { supplierId, product: { deletedAt: null } };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supplierProduct.count({ where }),
      this.prisma.supplierProduct.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          product: {
            include: { category: true, specs: true, images: true },
          },
        },
      }),
    ]);
    return { items: rows.map((row) => this.mapOwn(row)), page, limit, total };
  }

  async createOwn(userId: string, input: SupplierProductInput) {
    const supplierId = await this.resolveSupplierId(userId);
    await this.assertCategory(input.categoryId);
    const sku = input.sku ?? `NCC-${randomBytes(4).toString('hex').toUpperCase()}`;
    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          sku,
          name: input.name,
          spec: input.spec,
          moq: input.moq,
          leadTimeDays: input.leadTimeDays,
          categoryId: input.categoryId,
          // Supplier listings start as drafts: admin approval (D12) is needed
          // before they can be published to the public catalog.
          status: 'DRAFT',
        },
      });
      await tx.supplierProduct.create({
        data: {
          supplierId,
          productId: created.id,
          supplierSku: input.supplierSku,
          costPrice: input.costPrice,
          currency: input.currency ?? 'CNY',
          moq: input.moq,
          leadTimeDays: input.leadTimeDays,
        },
      });
      const row = await tx.supplierProduct.findUniqueOrThrow({
        where: { supplierId_productId: { supplierId, productId: created.id } },
        include: { product: { include: { category: true, specs: true, images: true } } },
      });
      return row;
    });
    await this.indexProduct(product.productId);
    await this.publicCatalog.bustCache();
    this.logger.log({ productId: product.productId, supplierId }, 'supplier product created');
    return this.mapOwn(product);
  }

  async getOwn(userId: string, productId: string) {
    const row = await this.findOwn(userId, productId);
    return this.mapOwn(row);
  }

  async updateOwn(userId: string, productId: string, input: UpdateSupplierProductInput) {
    const row = await this.findOwn(userId, productId);
    if (input.categoryId) await this.assertCategory(input.categoryId);
    await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id: row.productId },
        data: {
          name: input.name,
          spec: input.spec,
          moq: input.moq,
          leadTimeDays: input.leadTimeDays,
          categoryId: input.categoryId,
        },
      }),
      this.prisma.supplierProduct.update({
        where: { id: row.id },
        data: {
          supplierSku: input.supplierSku,
          costPrice: input.costPrice,
          currency: input.currency,
          // Keep the listing-level MOQ/lead time in sync with the product.
          moq: input.moq,
          leadTimeDays: input.leadTimeDays,
        },
      }),
    ]);
    await this.indexProduct(row.productId);
    await this.publicCatalog.bustCache();
    return this.getOwn(userId, productId);
  }

  // Suppliers can hide their listing any time; publishing needs admin approval.
  async setVisibility(userId: string, productId: string, input: SupplierProductVisibilityInput) {
    const row = await this.findOwn(userId, productId);
    if (input.visible && !row.approvedAt) {
      throw new ConflictException({
        code: 'APPROVAL_REQUIRED',
        message: 'Sản phẩm đang chờ admin duyệt trước khi hiển thị công khai.',
      });
    }
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        status: input.visible ? 'PUBLISHED' : 'DRAFT',
        publishedAt: input.visible ? (row.product.publishedAt ?? new Date()) : undefined,
      },
    });
    await this.indexProduct(productId);
    await this.publicCatalog.bustCache();
    return { id: productId, visible: input.visible };
  }

  // ------------------------------------------------------- admin (P4.5)

  async createSupplier(actor: AccessPayload, input: CreateSupplierInput) {
    const supplier = await this.prisma.supplier.create({
      data: {
        name: input.name,
        province: input.province,
        country: input.country ?? 'CN',
        contactName: input.contactName,
        contactPhone: input.contactPhone,
        contactWechat: input.contactWechat,
        address: input.address,
        notes: input.notes,
      },
    });
    this.logger.log({ supplierId: supplier.id, actor: actor.sub }, 'supplier created');
    return supplier;
  }

  // Creates the login user, grants the supplier role, links the account and
  // emails an invite to set a password (reuses the reset-password flow).
  async createAccount(actor: AccessPayload, input: CreateSupplierAccountInput) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: input.supplierId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!supplier) throw new NotFoundException('Nhà cung cấp không tồn tại.');

    const { account, user } = await this.prisma.$transaction(async (tx) => {
      // No password yet: the invite link below lets them choose one.
      const createdUser = await tx.user.create({
        data: {
          email: input.email,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      await tx.userRole.create({
        data: { userId: createdUser.id, role: Role.Supplier },
      });
      const createdAccount = await tx.supplierAccount.create({
        data: {
          userId: createdUser.id,
          supplierId: supplier.id,
          title: input.title,
          isPrimary: input.isPrimary ?? false,
        },
      });
      return { account: createdAccount, user: createdUser };
    });

    const token = randomBytes(32).toString('hex');
    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + AUTH_LIMITS.resetTtlMinutes * 60_000),
      },
    });
    const link = `${this.config.get<string>('app.appUrl', 'http://localhost:5180')}/reset-password?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'CVC – Lời mời tạo mật khẩu tài khoản nhà cung cấp',
      html: resetPasswordHtml(link, AUTH_LIMITS.resetTtlMinutes),
      text: resetPasswordText(link, AUTH_LIMITS.resetTtlMinutes),
    });
    this.logger.log(
      { accountId: account.id, supplierId: supplier.id, actor: actor.sub },
      'supplier account invited',
    );
    return {
      id: account.id,
      userId: user.id,
      email: user.email,
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: account.status,
    };
  }

  // `toggleAccount`: suspended accounts cannot log in (user disabled + all
  // sessions revoked). Open quotes are filtered by account status in P4.10.
  async setAccountStatus(
    actor: AccessPayload,
    accountId: string,
    input: SupplierAccountStatusInput,
  ) {
    const account = await this.prisma.supplierAccount.findUnique({
      where: { id: accountId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!account) throw new NotFoundException('Tài khoản nhà cung cấp không tồn tại.');

    const suspended = input.status === 'SUSPENDED';
    await this.prisma.$transaction([
      this.prisma.supplierAccount.update({
        where: { id: accountId },
        data: { status: input.status },
      }),
      this.prisma.user.update({
        where: { id: account.userId },
        data: { status: suspended ? 'DISABLED' : 'ACTIVE' },
      }),
      ...(suspended
        ? [
            this.prisma.session.updateMany({
              where: { userId: account.userId, revokedAt: null },
              data: { revokedAt: new Date() },
            }),
          ]
        : []),
    ]);
    this.logger.log(
      { accountId, status: input.status, actor: actor.sub },
      'supplier account status changed',
    );
    return { id: accountId, status: input.status, email: account.user.email };
  }

  // ---------------------------------------------------------------- helpers

  // Resolves the caller's supplier company; only active accounts may act.
  private async resolveSupplierId(userId: string): Promise<string> {
    const account = await this.prisma.supplierAccount.findUnique({
      where: { userId },
      select: { supplierId: true, status: true },
    });
    if (!account) {
      throw new NotFoundException('Tài khoản chưa liên kết nhà cung cấp.');
    }
    if (account.status === 'SUSPENDED') {
      throw new ConflictException({
        code: 'SUPPLIER_ACCOUNT_SUSPENDED',
        message: 'Tài khoản nhà cung cấp đã bị khóa.',
      });
    }
    return account.supplierId;
  }

  // Ownership guard (DoD): a supplier can only touch rows joined to its own id.
  private async findOwn(userId: string, productId: string) {
    const supplierId = await this.resolveSupplierId(userId);
    const row = await this.prisma.supplierProduct.findFirst({
      where: { productId, supplierId, product: { deletedAt: null } },
      include: { product: { include: { category: true, specs: true, images: true } } },
    });
    if (!row) throw new NotFoundException('Sản phẩm không tồn tại.');
    return row;
  }

  private async assertCategory(categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Danh mục không tồn tại.');
  }

  // Search index: drafts/unapproved listings are indexed as unpublished.
  private async indexProduct(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId },
      select: {
        name: true,
        spec: true,
        status: true,
        deletedAt: true,
        category: { select: { name: true } },
      },
    });
    if (!product || product.deletedAt) return;
    await this.search.upsert('product', productId, {
      title: product.name,
      keywords: [product.category?.name ?? '', product.spec ?? ''],
      status: product.status === 'PUBLISHED' ? 'published' : 'unpublished',
    });
  }

  private mapOwn(row: {
    supplierSku: string | null;
    costPrice: unknown;
    currency: string;
    approvedAt: Date | null;
    product: {
      id: string;
      sku: string;
      name: string;
      spec: string | null;
      moq: number;
      leadTimeDays: number | null;
      status: ProductStatus | string;
      publishedAt: Date | null;
      category: { id: string; name: string; slug: string } | null;
      specs: Array<{ key: string; value: string; sortIndex: number }>;
      images: Array<{
        id: string;
        fileObjectId: string | null;
        alt: string | null;
        sortIndex: number;
      }>;
    };
  }) {
    return {
      id: row.product.id,
      sku: row.product.sku,
      name: row.product.name,
      spec: row.product.spec,
      moq: row.product.moq,
      leadTimeDays: row.product.leadTimeDays,
      status: row.product.status,
      visible: row.product.status === 'PUBLISHED',
      approved: row.approvedAt !== null,
      approvedAt: row.approvedAt,
      publishedAt: row.product.publishedAt,
      category: row.product.category
        ? {
            id: row.product.category.id,
            name: row.product.category.name,
            slug: row.product.category.slug,
          }
        : null,
      specs: row.product.specs,
      images: row.product.images,
      // Supplier-only cost data (never exposed by the public catalog).
      supplierSku: row.supplierSku,
      costPrice: row.costPrice,
      currency: row.currency,
    };
  }
}
