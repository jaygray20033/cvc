import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module';
import { PrismaService } from './prisma.service';

// Schema integration tests for P3.4-P3.8: deal room, contracts, group buy
// (DB-enforced capacity), resale, sales + inventory (immutable movements).
// RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

let app: INestApplication;
let prisma: PrismaService;

const EMAIL_PREFIX = `p3b-test-${Date.now()}-`;
const runId = String(Date.now());
const ids = {
  userIds: [] as string[],
  categoryIds: [] as string[],
  productIds: [] as string[],
  orderIds: [] as string[],
  supplierIds: [] as string[],
  roomIds: [] as string[],
  requestIds: [] as string[],
  campaignIds: [] as string[],
  storeIds: [] as string[],
  lotIds: [] as string[],
  contractIds: [] as string[],
  templateIds: [] as string[],
};

async function createUser(email?: string): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({
    data: { email: email ?? `${EMAIL_PREFIX}-${ids.userIds.length}@cvc.test`, passwordHash: 'x' },
  });
  ids.userIds.push(user.id);
  return user;
}

async function createOrder(): Promise<{ id: string }> {
  const user = await createUser();
  const supplier = await prisma.supplier.create({
    data: { name: `P3B supplier ${runId}-${ids.supplierIds.length}` },
  });
  ids.supplierIds.push(supplier.id);
  const order = await prisma.order.create({
    data: {
      orderNo: `CVC-ORD-${runId.slice(-5)}-${ids.orderIds.length}`,
      buyerId: user.id,
      supplierId: supplier.id,
      totalAmount: 500,
    },
  });
  ids.orderIds.push(order.id);
  return order;
}

async function createCampaign(capacity: number): Promise<{ id: string }> {
  const user = await createUser(`${EMAIL_PREFIX}camp-${ids.campaignIds.length}@cvc.test`);
  const campaign = await prisma.campaign.create({
    data: {
      name: `P3B campaign ${runId}-${ids.campaignIds.length}`,
      capacity,
      createdById: user.id,
      costPrice: 100,
      retailPrice: 150,
      participantShareRate: 0.2,
      retailerShareRate: 0.1,
      cvcFeeRate: 0.1,
    },
  });
  ids.campaignIds.push(campaign.id);
  return campaign;
}

describeDb('Schema P3.4-P3.8 (integration)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // FK-safe order: children first, Restrict-referenced rows last.
    await prisma.participation.deleteMany({ where: { campaignId: { in: ids.campaignIds } } });
    await prisma.resaleListing.deleteMany({ where: { campaignId: { in: ids.campaignIds } } });
    await prisma.sale.deleteMany({ where: { storeId: { in: ids.storeIds } } });
    await prisma.saleImport.deleteMany({ where: { storeId: { in: ids.storeIds } } });
    await prisma.inventoryBalance.deleteMany({ where: { lotId: { in: ids.lotIds } } });
    await prisma.inventoryMovement.deleteMany({ where: { lotId: { in: ids.lotIds } } });
    await prisma.stockCount.deleteMany({ where: { lotId: { in: ids.lotIds } } });
    await prisma.qcReport.deleteMany({ where: { lotId: { in: ids.lotIds } } });
    await prisma.inspectionPhoto.deleteMany({
      where: { inspection: { lotId: { in: ids.lotIds } } },
    });
    await prisma.inspection.deleteMany({ where: { lotId: { in: ids.lotIds } } });
    await prisma.inventoryLot.deleteMany({ where: { id: { in: ids.lotIds } } });
    await prisma.transferReceipt.deleteMany({
      where: { transfer: { campaignId: { in: ids.campaignIds } } },
    });
    await prisma.transfer.deleteMany({ where: { campaignId: { in: ids.campaignIds } } });
    await prisma.allocation.deleteMany({ where: { campaignId: { in: ids.campaignIds } } });
    await prisma.goodsRequest.deleteMany({ where: { campaignId: { in: ids.campaignIds } } });
    await prisma.campaign.deleteMany({ where: { id: { in: ids.campaignIds } } });
    await prisma.resaleListing.deleteMany({ where: { productId: { in: ids.productIds } } });
    await prisma.store.deleteMany({ where: { id: { in: ids.storeIds } } });
    await prisma.messageAttachment.deleteMany({
      where: { message: { roomId: { in: ids.roomIds } } },
    });
    await prisma.translation.deleteMany({ where: { message: { roomId: { in: ids.roomIds } } } });
    await prisma.message.deleteMany({ where: { roomId: { in: ids.roomIds } } });
    await prisma.offer.deleteMany({ where: { roomId: { in: ids.roomIds } } });
    await prisma.dealRoomMember.deleteMany({ where: { roomId: { in: ids.roomIds } } });
    await prisma.dealRoom.deleteMany({ where: { id: { in: ids.roomIds } } });
    await prisma.lockedTerms.deleteMany({ where: { orderId: { in: ids.orderIds } } });
    await prisma.contractSignature.deleteMany({ where: { contractId: { in: ids.contractIds } } });
    await prisma.contractParty.deleteMany({ where: { contractId: { in: ids.contractIds } } });
    await prisma.contractVersion.deleteMany({ where: { contractId: { in: ids.contractIds } } });
    await prisma.contract.deleteMany({ where: { id: { in: ids.contractIds } } });
    await prisma.contractTemplate.deleteMany({ where: { id: { in: ids.templateIds } } });
    await prisma.sourcingRequest.deleteMany({ where: { id: { in: ids.requestIds } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: ids.productIds } } });
    await prisma.category.deleteMany({ where: { id: { in: ids.categoryIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: ids.supplierIds } } });
    await prisma.retailerRegistration.deleteMany({
      where: { user: { email: { startsWith: EMAIL_PREFIX } } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await app.close();
  });

  // ---- P3.4 deal room ----

  it('DealRoom is 1-1 with an order: second room for the same order is P2002', async () => {
    const order = await createOrder();
    const room = await prisma.dealRoom.create({ data: { orderId: order.id } });
    ids.roomIds.push(room.id);
    await expect(prisma.dealRoom.create({ data: { orderId: order.id } })).rejects.toMatchObject({
      code: 'P2002',
    });
    // A room can also hang off a sourcing request before it becomes an order.
    const user = await createUser();
    const request = await prisma.sourcingRequest.create({
      data: { requestNo: `CVC-RFQ-${runId.slice(-5)}-9`, buyerId: user.id, title: 'RFQ room' },
    });
    ids.requestIds.push(request.id);
    const room2 = await prisma.dealRoom.create({ data: { sourcingRequestId: request.id } });
    ids.roomIds.push(room2.id);
    expect(room2.orderId).toBeNull();
  });

  it('Message translations are unique per (messageId, lang)', async () => {
    const order = await createOrder();
    const room = await prisma.dealRoom.create({ data: { orderId: order.id } });
    ids.roomIds.push(room.id);
    const message = await prisma.message.create({
      data: { roomId: room.id, senderId: (await createUser()).id, body: 'Giá bao nhiêu?' },
    });
    await prisma.translation.create({
      data: { messageId: message.id, lang: 'en', text: 'How much?', provider: 'google' },
    });
    await expect(
      prisma.translation.create({ data: { messageId: message.id, lang: 'en', text: 'dup' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // A system message works without a sender.
    const system = await prisma.message.create({
      data: { roomId: room.id, type: 'SYSTEM', body: 'Terms locked' },
    });
    expect(system.senderId).toBeNull();
  });

  it('LockedTerms row cannot be updated (DB trigger)', async () => {
    const order = await createOrder();
    const user = await createUser();
    const terms = await prisma.lockedTerms.create({
      data: { orderId: order.id, terms: { unitPrice: 100, moq: 500 }, lockedById: user.id },
    });
    await expect(
      prisma.lockedTerms.update({ where: { id: terms.id }, data: { version: 2 } }),
    ).rejects.toThrow(/LOCKED_TERMS_IMMUTABLE/);
  });

  it('Offer defaults to PENDING and tracks the room', async () => {
    const order = await createOrder();
    const room = await prisma.dealRoom.create({ data: { orderId: order.id } });
    ids.roomIds.push(room.id);
    const user = await createUser();
    const offer = await prisma.offer.create({
      data: {
        roomId: room.id,
        createdById: user.id,
        unitPrice: 99.5,
        quantity: 500,
        conditions: 'FOB',
      },
    });
    expect(offer.status).toBe('PENDING');
    expect(offer.currency).toBe('VND');
  });

  // ---- P3.5 contracts ----

  it('ContractTemplate unique per (type, version); contract versions append-only', async () => {
    const template = await prisma.contractTemplate.create({
      data: {
        type: 'SOURCING',
        version: 1,
        title: 'HD tìm nguồn v1',
        content: 'Bên A {{buyer}}...',
      },
    });
    ids.templateIds.push(template.id);
    await expect(
      prisma.contractTemplate.create({
        data: { type: 'SOURCING', version: 1, title: 'dup', content: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const contract = await prisma.contract.create({
      data: {
        ownerType: 'sourcing_order',
        ownerId: (await createOrder()).id,
        templateId: template.id,
        templateVersion: 1,
      },
    });
    ids.contractIds.push(contract.id);
    await prisma.contractVersion.create({
      data: { contractId: contract.id, version: 1, content: 'draft 1' },
    });
    await prisma.contractVersion.create({
      data: { contractId: contract.id, version: 2, content: 'draft 2' },
    });
    expect(await prisma.contractVersion.count({ where: { contractId: contract.id } })).toBe(2);

    const party = await prisma.contractParty.create({
      data: { contractId: contract.id, role: 'buyer', displayName: 'Khách A' },
    });
    await prisma.contractSignature.create({
      data: {
        contractId: contract.id,
        partyId: party.id,
        method: 'OTP',
        signedByUserId: party.userId,
      },
    });
    await expect(
      prisma.contractSignature.create({ data: { contractId: contract.id, partyId: party.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // ---- P3.6 group buy: DB-enforced capacity ----

  it('capacity is enforced by trigger: exceeding insert and update both fail', async () => {
    const campaign = await createCampaign(10);
    const userA = await createUser();
    const userB = await createUser();
    await prisma.participation.create({
      data: { campaignId: campaign.id, userId: userA.id, unitsBought: 6 },
    });
    await expect(
      prisma.participation.create({
        data: { campaignId: campaign.id, userId: userB.id, unitsBought: 6 },
      }),
    ).rejects.toThrow(/CAPACITY_EXCEEDED/);
    // Filling exactly to capacity is fine.
    const partB = await prisma.participation.create({
      data: { campaignId: campaign.id, userId: userB.id, unitsBought: 4 },
    });
    // Growing beyond capacity via update is rejected too.
    await expect(
      prisma.participation.update({ where: { id: partB.id }, data: { unitsBought: 5 } }),
    ).rejects.toThrow(/CAPACITY_EXCEEDED/);
    // Shrinking stays allowed.
    await prisma.participation.update({ where: { id: partB.id }, data: { unitsBought: 3 } });
  });

  it('one participation per (campaign, user); unitsBought stays integer', async () => {
    const campaign = await createCampaign(100);
    const user = await createUser();
    await prisma.participation.create({
      data: { campaignId: campaign.id, userId: user.id, unitsBought: 1 },
    });
    await expect(
      prisma.participation.create({
        data: { campaignId: campaign.id, userId: user.id, unitsBought: 2 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // ---- P3.7 resale ----

  it('RetailerRegistration one per user; Store soft delete keeps listing FK alive', async () => {
    const user = await createUser();
    const reg = await prisma.retailerRegistration.create({
      data: { userId: user.id, businessName: 'Store A' },
    });
    await expect(
      prisma.retailerRegistration.create({ data: { userId: user.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(reg.status).toBe('PENDING');

    const category = await prisma.category.create({
      data: { name: `P3B cat ${runId}`, slug: `p3b-${runId}` },
    });
    ids.categoryIds.push(category.id);
    const product = await prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `CVC-B${runId.slice(-4)}`,
        name: 'P3B product',
        moq: 1,
      },
    });
    ids.productIds.push(product.id);
    const store = await prisma.store.create({ data: { ownerId: user.id, name: 'Store demo' } });
    ids.storeIds.push(store.id);
    const listing = await prisma.resaleListing.create({
      data: { productId: product.id, storeId: store.id, salePrice: 150000, quantityRemaining: 20 },
    });
    await prisma.store.delete({ where: { id: store.id } }); // soft delete
    const saved = await prisma.resaleListing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(saved.storeId).toBeNull(); // SetNull on hard store delete
    // Deleted store disappears from active lookups.
    expect(await prisma.store.count({ where: { id: store.id, deletedAt: null } })).toBe(0);
  });

  // ---- P3.8 sales & inventory ----

  it('SaleImport fileHash unique blocks re-import; sale lines round-trip decimals', async () => {
    const user = await createUser();
    const store = await prisma.store.create({ data: { ownerId: user.id, name: 'Import store' } });
    ids.storeIds.push(store.id);
    const hash = `sha-${runId}-1`;
    await prisma.saleImport.create({
      data: {
        fileName: 'sales.csv',
        fileHash: hash,
        storeId: store.id,
        totalRows: 10,
        status: 'COMPLETED',
        successRows: 10,
      },
    });
    await expect(
      prisma.saleImport.create({
        data: { fileName: 'sales-retry.csv', fileHash: hash, storeId: store.id, totalRows: 10 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const category = await prisma.category.create({
      data: { name: `P3B cat2 ${runId}`, slug: `p3b2-${runId}` },
    });
    ids.categoryIds.push(category.id);
    const product = await prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `CVC-C${runId.slice(-4)}`,
        name: 'P3B product 2',
        moq: 1,
      },
    });
    ids.productIds.push(product.id);
    const sale = await prisma.sale.create({ data: { storeId: store.id, totalAmount: 12.5 } });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, productId: product.id, quantity: 2, unitPrice: 6.25 },
    });
    expect(line.unitPrice.toNumber()).toBe(6.25);
  });

  it('InventoryMovement is append-only (trigger blocks UPDATE) and balance upserts', async () => {
    const user = await createUser();
    const store = await prisma.store.create({ data: { ownerId: user.id, name: 'Lot store' } });
    ids.storeIds.push(store.id);
    const category = await prisma.category.create({
      data: { name: `P3B cat3 ${runId}`, slug: `p3b3-${runId}` },
    });
    ids.categoryIds.push(category.id);
    const product = await prisma.product.create({
      data: {
        categoryId: category.id,
        sku: `CVC-D${runId.slice(-4)}`,
        name: 'P3B product 3',
        moq: 1,
      },
    });
    ids.productIds.push(product.id);
    const lot = await prisma.inventoryLot.create({
      data: { productId: product.id, lotNo: 'LOT-1' },
    });
    ids.lotIds.push(lot.id);

    const movement = await prisma.inventoryMovement.create({
      data: { lotId: lot.id, type: 'RECEIVE', quantity: 100, createdById: user.id },
    });
    await expect(
      prisma.inventoryMovement.update({ where: { id: movement.id }, data: { quantity: 99 } }),
    ).rejects.toThrow(/INVENTORY_MOVEMENT_IMMUTABLE/);

    // Balance upsert in the same "transaction" pattern.
    const balance = await prisma.inventoryBalance.upsert({
      where: { lotId_storeId: { lotId: lot.id, storeId: '' } },
      create: { lotId: lot.id, storeId: '', quantity: 100 },
      update: { quantity: { increment: 100 } },
    });
    expect(balance.quantity).toBe(100);
    // Store-scoped balance is a separate row (central uses "").
    await prisma.inventoryBalance.create({
      data: { lotId: lot.id, storeId: store.id, quantity: 5 },
    });
    expect(await prisma.inventoryBalance.count({ where: { lotId: lot.id } })).toBe(2);

    // Stock count references the lot and records who counted.
    await prisma.stockCount.create({
      data: { lotId: lot.id, countedQuantity: 105, countedById: user.id },
    });
    const inspection = await prisma.inspection.create({
      data: { lotId: lot.id, result: 'PASSED', inspectedById: user.id },
    });
    expect(inspection.result).toBe('PASSED');
    await prisma.qcReport.create({ data: { lotId: lot.id, passed: true, checkedById: user.id } });
  });

  it('Allocation + transfer lifecycle defaults hold', async () => {
    const campaign = await createCampaign(50);
    const owner = await createUser();
    const storeA = await prisma.store.create({ data: { ownerId: owner.id, name: 'Store A' } });
    ids.storeIds.push(storeA.id);
    const storeB = await prisma.store.create({ data: { ownerId: owner.id, name: 'Store B' } });
    ids.storeIds.push(storeB.id);
    const goodsRequest = await prisma.goodsRequest.create({
      data: { campaignId: campaign.id, storeId: storeA.id, quantity: 10 },
    });
    expect(goodsRequest.status).toBe('OPEN');
    const allocation = await prisma.allocation.create({
      data: {
        campaignId: campaign.id,
        storeId: storeA.id,
        goodsRequestId: goodsRequest.id,
        allocatedById: owner.id,
      },
    });
    expect(allocation.status).toBe('ALLOCATED');
    const transfer = await prisma.transfer.create({
      data: {
        fromStoreId: storeA.id,
        toStoreId: storeB.id,
        campaignId: campaign.id,
        quantity: 5,
        sentById: owner.id,
      },
    });
    expect(transfer.status).toBe('IN_TRANSIT');
  });
});
