import { randomUUID } from 'node:crypto';

import { orderStageIndex } from '@cvc/shared';
import { HttpException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type OrderStatus } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { encryptCccdNumber } from '../common/utils/validators';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerInfoService } from './customer-info.service';

// P4.18 integration — profile/KYC suggestion, buyer-only edits, supplier
// privacy, completeness validation and the contract lock. RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4m-test-';
const SUPPLIER_PREFIX = 'P4M Supplier ';
const ORDER_PREFIX = 'P4M-';
const CCCD = '012345678901';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokenService;
let customerInfo: CustomerInfoService;

interface TestUser {
  id: string;
  email: string;
  accessToken: string;
}

let buyer: TestUser;
let supplierUser: TestUser;
let sales: TestUser;
let admin: TestUser;
let outsider: TestUser;
let supplierId: string;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

async function createUser(roles: string[]): Promise<TestUser> {
  const email = makeEmail();
  const user = await prisma.user.create({
    data: { email, passwordHash: 'x', emailVerifiedAt: new Date(), status: 'ACTIVE' },
  });
  await prisma.userRole.createMany({ data: roles.map((role) => ({ userId: user.id, role })) });
  const sessionId = randomUUID();
  await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      familyId: randomUUID(),
      refreshHash: tokens.hashToken(randomUUID()),
      activeRole: roles[0],
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return {
    id: user.id,
    email,
    accessToken: tokens.accessToken({ sub: user.id, email, sid: sessionId, role: roles[0] }),
  };
}

async function cleanup(): Promise<void> {
  const orders = await prisma.order.findMany({
    where: { orderNo: { startsWith: ORDER_PREFIX } },
    select: { id: true },
  });
  const ids = orders.map((order) => order.id);
  if (ids.length > 0) {
    await prisma.contract.deleteMany({
      where: { ownerType: 'sourcing_order', ownerId: { in: ids } },
    });
  }
  await prisma.order.deleteMany({ where: { orderNo: { startsWith: ORDER_PREFIX } } });
  await prisma.contractTemplate.deleteMany({ where: { title: { startsWith: 'P4M' } } });
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: SUPPLIER_PREFIX } },
    select: { id: true },
  });
  await prisma.supplier.deleteMany({ where: { id: { in: suppliers.map((row) => row.id) } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
}

async function expectContractError(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error('expected a contract-readiness error');
  } catch (error) {
    if (error instanceof HttpException) {
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toMatchObject({ code });
      return;
    }
    throw error;
  }
}

describeDb('Customer info for contracts (P4.18)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
    customerInfo = app.get(CustomerInfoService);
    await cleanup();

    buyer = await createUser(['buyer']);
    supplierUser = await createUser(['supplier']);
    sales = await createUser(['sales']);
    admin = await createUser(['admin']);
    outsider = await createUser(['buyer']);

    const supplier = await prisma.supplier.create({
      data: { name: `${SUPPLIER_PREFIX}${Date.now()}`, status: 'ACTIVE' },
    });
    supplierId = supplier.id;
    await prisma.supplierAccount.create({
      data: { userId: supplierUser.id, supplierId, isPrimary: true },
    });

    await prisma.profile.create({
      data: {
        userId: buyer.id,
        orgType: 'PERSONAL',
        displayName: 'Nguyễn Văn P4M',
        address: 'Số 1 Xuân Thủy, Dịch Vọng, Cầu Giấy, Hà Nội',
      },
    });
    // Approved KYC supplies the CCCD that the customer-info PUT can inherit.
    await prisma.kycSubmission.create({
      data: {
        userId: buyer.id,
        status: 'APPROVED',
        reviewedAt: new Date(),
        cccdNumberEnc: encryptCccdNumber(CCCD, process.env.ENCRYPTION_KEY ?? ''),
      },
    });
  }, 90_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const api = () => request(app.getHttpServer());

  async function createOrder(status: OrderStatus = 'NEGOTIATING') {
    return prisma.order.create({
      data: {
        orderNo: `${ORDER_PREFIX}${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`,
        buyerId: buyer.id,
        supplierId,
        status,
        stageIndex: orderStageIndex(status as 'NEGOTIATING'),
        totalAmount: 2_000_000,
        depositAmount: 1_000_000,
        currency: 'VND',
      },
    });
  }

  function getInfo(orderId: string, user: TestUser) {
    return api().get(`/api/v1/orders/${orderId}/customer-info`).set(auth(user));
  }

  function putInfo(orderId: string, user: TestUser, body: Record<string, unknown>) {
    return api().put(`/api/v1/orders/${orderId}/customer-info`).set(auth(user)).send(body);
  }

  it('suggests legal data from Profile/approved KYC and enforces read access', async () => {
    const order = await createOrder();
    const response = await getInfo(order.id, buyer);

    expect(response.status).toBe(200);
    expect(response.body.saved).toBe(false);
    expect(response.body.readyForContract).toBe(false);
    expect(response.body.info).toBeNull();
    expect(response.body.locked).toBe(false);
    expect(response.body.suggested).toMatchObject({
      orgType: 'PERSONAL',
      legalName: 'Nguyễn Văn P4M',
      cccdMasked: '****8901',
      address: 'Số 1 Xuân Thủy, Dịch Vọng, Cầu Giấy, Hà Nội',
    });
    expect(response.body.kyc.status).toBe('APPROVED');
    expect(JSON.stringify(response.body)).not.toContain(CCCD);

    expect((await getInfo(order.id, sales)).status).toBe(200);
    expect((await getInfo(order.id, admin)).status).toBe(200);
    const supplierView = await getInfo(order.id, supplierUser);
    expect(supplierView.status).toBe(403);
    expect(supplierView.body.code).toBe('FORBIDDEN');
    expect((await getInfo(order.id, outsider)).status).toBe(404);
  });

  it('rejects incomplete info, non-buyer writes and raw CCCD reuse', async () => {
    const order = await createOrder();
    await expectContractError(
      () => customerInfo.assertReadyForContract(order.id),
      'CUSTOMER_INFO_REQUIRED',
    );

    const incomplete = await putInfo(order.id, buyer, {
      orgType: 'BUSINESS_HOUSEHOLD',
      legalName: 'Hộ kinh doanh P4M',
      address: 'Số 2 Trần Duy Hưng, Hà Nội',
    });
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.code).toBe('CUSTOMER_INFO_INCOMPLETE');
    expect(incomplete.body.message).toContain('taxId');
    expect(incomplete.body.message).toContain('representativeName');

    const validBody = {
      orgType: 'PERSONAL',
      legalName: 'Nguyễn Văn P4M',
      address: 'Số 1 Xuân Thủy, Dịch Vọng, Cầu Giấy, Hà Nội',
    };
    expect((await putInfo(order.id, supplierUser, validBody)).status).toBe(403);
    expect((await putInfo(order.id, sales, validBody)).status).toBe(403);
    expect((await putInfo(order.id, admin, validBody)).status).toBe(403);
    expect((await putInfo(order.id, outsider, validBody)).status).toBe(404);

    const badCccd = await putInfo(order.id, buyer, {
      ...validBody,
      cccdNumber: '123',
    });
    expect(badCccd.status).toBe(400);
    expect(['BAD_REQUEST', 'VALIDATION_ERROR']).toContain(badCccd.body.code);

    // Contract is still impossible while only the profile/KYC suggestion exists.
    expect((await api().get(`/api/v1/orders/${order.id}`).set(auth(buyer))).status).toBe(200);
  });

  it('saves complete personal info, inherits CCCD from KYC and locks with contract', async () => {
    const order = await createOrder();

    const saved = await putInfo(order.id, buyer, {
      orgType: 'PERSONAL',
      legalName: 'Nguyễn Văn P4M',
      address: 'Số 1 Xuân Thủy, Dịch Vọng, Cầu Giấy, Hà Nội',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toBe(true);
    expect(saved.body.readyForContract).toBe(true);
    expect(saved.body.missingFields).toEqual([]);
    expect(saved.body.info).toMatchObject({
      orgType: 'PERSONAL',
      legalName: 'Nguyễn Văn P4M',
      cccdMasked: '****8901',
      hasCccd: true,
      version: 1,
    });
    expect(JSON.stringify(saved.body)).not.toContain(CCCD);

    const stored = await prisma.orderCustomerInfo.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(stored.cccdLast4).toBe('8901');
    expect(stored.cccdNumberEnc).toBeTruthy();
    expect(stored.cccdNumberEnc).not.toContain(CCCD);

    await expect(customerInfo.assertReadyForContract(order.id)).resolves.toBeUndefined();
    const contractData = await customerInfo.getContractData(order.id);
    expect(contractData).toMatchObject({
      orgType: 'PERSONAL',
      legalName: 'Nguyễn Văn P4M',
      cccdNumber: CCCD,
    });

    const template = await prisma.contractTemplate.create({
      data: {
        type: 'SOURCING',
        version: 910_000 + Math.floor(Math.random() * 90_000),
        title: `P4M template ${Date.now()}`,
        content: 'P4M',
      },
    });
    const contract = await prisma.contract.create({
      data: {
        ownerType: 'sourcing_order',
        ownerId: order.id,
        templateId: template.id,
        templateVersion: 1,
        status: 'DRAFT',
      },
    });

    const locked = await getInfo(order.id, buyer);
    expect(locked.status).toBe(200);
    expect(locked.body.locked).toBe(true);
    expect(locked.body.contractId).toBe(contract.id);
    expect(locked.body.readyForContract).toBe(true);

    const rejected = await putInfo(order.id, buyer, {
      orgType: 'PERSONAL',
      legalName: 'Tên đã đổi',
      address: 'Địa chỉ mới, Hà Nội',
    });
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('CUSTOMER_INFO_LOCKED');

    const unchanged = await prisma.orderCustomerInfo.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(unchanged.legalName).toBe('Nguyễn Văn P4M');
    expect(unchanged.version).toBe(1);
  });

  it('requires tax id and representative for business customers', async () => {
    const order = await createOrder();
    const saved = await putInfo(order.id, buyer, {
      orgType: 'COMPANY',
      legalName: 'Công ty P4M',
      taxId: '0123456789',
      businessRegNo: '0312345678',
      representativeName: 'Trần Thị P4M',
      address: 'Số 3 Láng Hạ, Đống Đa, Hà Nội',
    });
    expect(saved.status).toBe(200);
    expect(saved.body.readyForContract).toBe(true);
    expect(saved.body.info).toMatchObject({
      orgType: 'COMPANY',
      taxId: '0123456789',
      businessRegNo: '0312345678',
      representativeName: 'Trần Thị P4M',
      cccdMasked: null,
    });
    await expect(customerInfo.assertReadyForContract(order.id)).resolves.toBeUndefined();

    const missingRep = await putInfo(order.id, buyer, {
      orgType: 'COMPANY',
      legalName: 'Công ty P4M',
      taxId: '0123456789',
      representativeName: null,
      address: 'Số 3 Láng Hạ, Đống Đa, Hà Nội',
    });
    expect(missingRep.status).toBe(400);
    expect(missingRep.body.code).toBe('CUSTOMER_INFO_INCOMPLETE');
    expect(missingRep.body.message).toContain('representativeName');
  });
});
