import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OrderStatus } from '@prisma/client';

import { AppModule } from '../app.module';
import { PrismaService } from './prisma.service';

// Schema integration tests for the P3.1-P3.3 tables: unique keys surface as
// P2002, FK restrict as P2003, defaults and cascade/set-null behavior hold.
// RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

let app: INestApplication;
let prisma: PrismaService;

const EMAIL_PREFIX = `p3-test-${Date.now()}-`;
const runId = String(Date.now());
const ids = {
  userIds: [] as string[],
  categoryIds: [] as string[],
  productIds: [] as string[],
  supplierIds: [] as string[],
  orderIds: [] as string[],
  requestIds: [] as string[],
  fileIds: [] as string[],
  orgIds: [] as string[],
};

async function createUser(email?: string): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({
    data: {
      email: email ?? `${EMAIL_PREFIX}${runId}-${ids.userIds.length}@cvc.test`,
      passwordHash: 'x',
    },
  });
  ids.userIds.push(user.id);
  return user;
}

async function createCategory(): Promise<{ id: string }> {
  const category = await prisma.category.create({
    data: { name: `P3 test ${runId}`, slug: `p3-test-${runId}-${ids.categoryIds.length}` },
  });
  ids.categoryIds.push(category.id);
  return category;
}

async function createProduct(categoryId: string): Promise<{ id: string; sku: string }> {
  const product = await prisma.product.create({
    data: {
      categoryId,
      sku: `CVC-${runId.slice(-4)}-${ids.productIds.length}`,
      name: 'Áo mưa test P3',
      moq: 100,
      priceRef: 12.34,
    },
  });
  ids.productIds.push(product.id);
  return product;
}

async function createSupplier(): Promise<{ id: string }> {
  const supplier = await prisma.supplier.create({
    data: { name: `P3 supplier ${runId}-${ids.supplierIds.length}` },
  });
  ids.supplierIds.push(supplier.id);
  return supplier;
}

async function createOrder(buyerId: string, supplierId: string): Promise<{ id: string }> {
  const order = await prisma.order.create({
    data: {
      orderNo: `CVC-ORD-${runId.slice(-5)}-${ids.orderIds.length}`,
      buyerId,
      supplierId,
      totalAmount: 1000.5,
    },
  });
  ids.orderIds.push(order.id);
  return order;
}

describeDb('Schema P3 (integration: P3.1-P3.3)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Delete in FK-safe order: orders cascade to children, RFQs cascade to
    // quotes + selections (which restrict supplier deletion otherwise).
    await prisma.order.deleteMany({ where: { id: { in: ids.orderIds } } });
    await prisma.sourcingRequest.deleteMany({ where: { id: { in: ids.requestIds } } });
    await prisma.product.deleteMany({ where: { id: { in: ids.productIds } } });
    await prisma.category.deleteMany({ where: { id: { in: ids.categoryIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: ids.supplierIds } } });
    await prisma.fileObject.deleteMany({ where: { id: { in: ids.fileIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: ids.orgIds } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await app.close();
  });

  it('unique SKU and user phone violations surface as P2002', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    await expect(
      prisma.product.create({
        data: { categoryId: category.id, sku: product.sku, name: 'dup', moq: 1 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const user = await createUser();
    // Unique per run so a crashed earlier run cannot collide with this phone.
    const phone = `09${runId.slice(-8)}`;
    await prisma.user.update({ where: { id: user.id }, data: { phone } });
    await expect(
      prisma.user.create({ data: { email: `${EMAIL_PREFIX}dup2@cvc.test`, phone } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('Order defaults: NEGOTIATING status and stageIndex 0, Decimal money round-trips', async () => {
    const user = await createUser();
    const supplier = await createSupplier();
    const order = await createOrder(user.id, supplier.id);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(saved.status).toBe('NEGOTIATING');
    expect(saved.stageIndex).toBe(0);
    expect(saved.totalAmount.toNumber()).toBe(1000.5);
    expect(saved.currency).toBe('VND');
  });

  it('FK restrict: user with orders and category with products cannot be deleted (P2003)', async () => {
    const user = await createUser();
    const supplier = await createSupplier();
    await createOrder(user.id, supplier.id);
    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toMatchObject({
      code: 'P2003',
    });

    const category = await createCategory();
    const product = await createProduct(category.id);
    await expect(prisma.category.delete({ where: { id: category.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.supplier.delete({ where: { id: supplier.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    expect(product).toBeDefined();
  });

  it('TotpSecret enforces one row per user (unique userId)', async () => {
    const user = await createUser();
    await prisma.totpSecret.create({ data: { userId: user.id, secretEnc: 'enc' } });
    await expect(
      prisma.totpSecret.create({ data: { userId: user.id, secretEnc: 'enc2' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('file references are SetNull: image survives file deletion with null fileId', async () => {
    const category = await createCategory();
    const product = await createProduct(category.id);
    const file = await prisma.fileObject.create({
      data: {
        ownerType: 'product',
        ownerId: product.id,
        bucket: 'cvc-public',
        s3Key: 'p3-test.jpg',
        declaredMime: 'image/jpeg',
        sizeBytes: 1,
      },
    });
    ids.fileIds.push(file.id);
    const image = await prisma.productImage.create({
      data: { productId: product.id, fileObjectId: file.id },
    });
    await prisma.fileObject.delete({ where: { id: file.id } });
    const saved = await prisma.productImage.findUniqueOrThrow({ where: { id: image.id } });
    expect(saved.fileObjectId).toBeNull();
  });

  it('QuoteSelection is one per quote; claim resolution one per claim', async () => {
    const user = await createUser();
    const supplier = await createSupplier();
    const request = await prisma.sourcingRequest.create({
      data: { requestNo: `CVC-RFQ-${runId.slice(-5)}-1`, buyerId: user.id, title: 'RFQ P3' },
    });
    ids.requestIds.push(request.id);
    const quote = await prisma.quote.create({
      data: {
        requestId: request.id,
        supplierId: supplier.id,
        unitPrice: 9.9,
        moq: 1,
        leadTimeDays: 7,
      },
    });
    await prisma.quoteSelection.create({
      data: { requestId: request.id, quoteId: quote.id, decidedById: user.id },
    });
    await expect(
      prisma.quoteSelection.create({
        data: { requestId: request.id, quoteId: quote.id, decidedById: user.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const order = await createOrder(user.id, supplier.id);
    const claim = await prisma.claim.create({
      data: {
        claimNo: `CVC-CLM-${runId.slice(-5)}-1`,
        orderId: order.id,
        type: 'QUALITY',
        reason: 'test',
        filedById: user.id,
      },
    });
    await prisma.claimResolution.create({
      data: { claimId: claim.id, decision: 'REFUND', decidedById: user.id },
    });
    await expect(
      prisma.claimResolution.create({
        data: { claimId: claim.id, decision: 'REJECT', decidedById: user.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('order children (stage logs, events) cascade on delete for test cleanup', async () => {
    const user = await createUser();
    const supplier = await createSupplier();
    const order = await createOrder(user.id, supplier.id);
    await prisma.orderStageLog.create({
      data: { orderId: order.id, stageIndex: 1, status: 'SAMPLING', actorId: user.id },
    });
    await prisma.orderEvent.create({
      data: { orderId: order.id, type: 'message.new', actorId: user.id },
    });
    await prisma.order.delete({ where: { id: order.id } });
    expect(await prisma.orderStageLog.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.orderEvent.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('BankAccount accepts an organization owner (nullable userId)', async () => {
    const user = await createUser();
    const org = await prisma.organization.create({
      data: { name: `P3 org ${runId}`, ownerId: user.id },
    });
    ids.orgIds.push(org.id);
    const account = await prisma.bankAccount.create({
      data: {
        organizationId: org.id,
        bankName: 'Vietcombank',
        holderName: 'Org',
        accountNoEnc: 'enc',
        accountNoLast4: '1234',
        accountNoHash: `p3-${runId}`,
      },
    });
    expect(account.userId).toBeNull();
    expect(account.organizationId).toBe(org.id);
    await prisma.bankAccount.delete({ where: { id: account.id } });
  });

  it('D7 enum covers all 10 internal states plus CANCELLED', () => {
    const values = Object.values(OrderStatus);
    for (const status of [
      'NEGOTIATING',
      'SAMPLING',
      'CONTRACT',
      'DEPOSIT',
      'PRODUCTION',
      'QC',
      'FINAL_PAYMENT',
      'SHIPPING',
      'RECEIVED',
      'COMPLETED',
      'CANCELLED',
    ]) {
      expect(values).toContain(status);
    }
  });
});
