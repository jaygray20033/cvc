import { randomUUID } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { TokenService } from '../auth/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Integration tests for P4.6 partner banners: admin CRUD, public feed and the
// display window (DoD: expired banners hide themselves). RUN_DB_TESTS=1.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const EMAIL_PREFIX = 'p4c-test-';

let app: INestApplication;
let prisma: PrismaService;
let redis: RedisService;
let tokens: TokenService;

function makeEmail(): string {
  return `${EMAIL_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e9)}@example.com`;
}

async function createUser(roles: string[]): Promise<{ email: string; accessToken: string }> {
  const email = makeEmail();
  const user = await prisma.user.create({
    data: { email, passwordHash: 'x', emailVerifiedAt: new Date() },
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
    email,
    accessToken: tokens.accessToken({ sub: user.id, email, sid: sessionId, role: roles[0] }),
  };
}

describeDb('Partner banners (P4.6)', () => {
  let adminToken = '';
  let buyerToken = '';

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    tokens = app.get(TokenService);
    await cleanup();
    adminToken = (await createUser(['admin'])).accessToken;
    buyerToken = (await createUser(['buyer'])).accessToken;
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  async function cleanup(): Promise<void> {
    await prisma.partnerBanner.deleteMany({ where: { name: { startsWith: 'p4c-banner-' } } });
    await prisma.fileObject.deleteMany({ where: { ownerId: 'p4c-logo-test' } });
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
    await redis.deleteByPattern('banners:public:*');
  }

  let seq = 0;
  function bannerName(label: string): string {
    seq += 1;
    return `p4c-banner-${label}-${Date.now()}-${seq}`;
  }

  function admin() {
    return { Authorization: `Bearer ${adminToken}` };
  }

  it('RBAC: only admins manage banners; the public feed needs no token', async () => {
    const denied = await request(app.getHttpServer())
      .post('/api/v1/admin/partner-banners')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ partnerType: 'SUPPLIER', name: bannerName('rbac'), position: 'HOME_TOP' });
    expect(denied.status).toBe(403);

    const publicFeed = await request(app.getHttpServer()).get('/api/v1/public/partner-banners');
    expect(publicFeed.status).toBe(200);
    expect(Array.isArray(publicFeed.body.items)).toBe(true);
  });

  it('display window: only active, in-range banners reach the public feed', async () => {
    const create = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post('/api/v1/admin/partner-banners').set(admin()).send(body);

    const live = await create({
      partnerType: 'SUPPLIER',
      name: bannerName('live'),
      position: 'HOME_TOP',
      linkUrl: 'https://example.com/ncc',
      sortIndex: 1,
    });
    expect(live.status).toBe(201);

    const expired = await create({
      partnerType: 'SUPPLIER',
      name: bannerName('expired'),
      position: 'HOME_TOP',
      startsAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
      endsAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    expect(expired.status).toBe(201);

    const future = await create({
      partnerType: 'SHIPPING',
      name: bannerName('future'),
      position: 'HOME_TOP',
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(future.status).toBe(201);

    const inactive = await create({
      partnerType: 'SHIPPING',
      name: bannerName('inactive'),
      position: 'HOME_TOP',
      isActive: false,
    });
    expect(inactive.status).toBe(201);

    const feed = await request(app.getHttpServer()).get('/api/v1/public/partner-banners');
    const names = feed.body.items.map((item: { name: string }) => item.name);
    expect(names).toContain(live.body.name);
    expect(names).not.toContain(expired.body.name);
    expect(names).not.toContain(future.body.name);
    expect(names).not.toContain(inactive.body.name);

    // Admin list still sees everything (including expired drafts).
    const adminList = await request(app.getHttpServer())
      .get('/api/v1/admin/partner-banners')
      .set(admin());
    const adminNames = adminList.body.items.map((item: { name: string }) => item.name);
    expect(adminNames).toEqual(
      expect.arrayContaining([
        live.body.name,
        expired.body.name,
        future.body.name,
        inactive.body.name,
      ]),
    );

    // Public payload stays a whitelist (no internal window/active flags).
    const liveItem = feed.body.items.find((item: { name: string }) => item.name === live.body.name);
    expect(liveItem.linkUrl).toBe('https://example.com/ncc');
    const json = JSON.stringify(liveItem).toLowerCase();
    expect(json).not.toContain('isactive');
    expect(json).not.toContain('endsat');
    expect(json).not.toContain('startsat');
  });

  it('expiry is immediate: ending a live banner hides it from the public feed', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/partner-banners')
      .set(admin())
      .send({
        partnerType: 'SHIPPING',
        name: bannerName('expire-me'),
        position: 'HOME_MID',
        sortIndex: 2,
      });
    expect(created.status).toBe(201);

    const before = await request(app.getHttpServer()).get(
      '/api/v1/public/partner-banners?position=HOME_MID',
    );
    expect(before.body.items.map((item: { name: string }) => item.name)).toContain(
      created.body.name,
    );

    // Editing the window to the past hides it (cache is busted on write).
    const ended = await request(app.getHttpServer())
      .put(`/api/v1/admin/partner-banners/${created.body.id}`)
      .set(admin())
      .send({ endsAt: new Date(Date.now() - 60_000).toISOString() });
    expect(ended.status).toBe(200);

    const after = await request(app.getHttpServer()).get(
      '/api/v1/public/partner-banners?position=HOME_MID',
    );
    expect(after.body.items.map((item: { name: string }) => item.name)).not.toContain(
      created.body.name,
    );

    // Delete removes it from admin lists too.
    expect(
      (
        await request(app.getHttpServer())
          .delete(`/api/v1/admin/partner-banners/${created.body.id}`)
          .set(admin())
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/v1/admin/partner-banners/${created.body.id}`)
          .set(admin())
      ).status,
    ).toBe(404);
  });

  it('validation: bad window, bad link and unconfirmed logo are rejected', async () => {
    const base = {
      partnerType: 'SUPPLIER',
      name: bannerName('invalid'),
      position: 'HOME_TOP',
    };

    const badWindow = await request(app.getHttpServer())
      .post('/api/v1/admin/partner-banners')
      .set(admin())
      .send({
        ...base,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() - 86_400_000).toISOString(),
      });
    expect(badWindow.status).toBe(400);

    const badLink = await request(app.getHttpServer())
      .post('/api/v1/admin/partner-banners')
      .set(admin())
      .send({ ...base, linkUrl: 'javascript:alert(1)' });
    expect(badLink.status).toBe(400);

    const uploadingFile = await prisma.fileObject.create({
      data: {
        ownerType: 'banner',
        ownerId: 'p4c-logo-test',
        bucket: 'files',
        s3Key: `p4c/logo-${Date.now()}.png`,
        declaredMime: 'image/png',
        sizeBytes: 64,
        status: 'UPLOADING',
      },
    });
    const badLogo = await request(app.getHttpServer())
      .post('/api/v1/admin/partner-banners')
      .set(admin())
      .send({ ...base, logoFileObjectId: uploadingFile.id });
    expect(badLogo.status).toBe(400);
  });

  it('filters by partnerType and sorts by sortIndex', async () => {
    const create = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post('/api/v1/admin/partner-banners').set(admin()).send(body);

    const later = await create({
      partnerType: 'SUPPLIER',
      name: bannerName('sort-later'),
      position: 'SEARCH_SIDEBAR',
      sortIndex: 9,
    });
    const earlier = await create({
      partnerType: 'SUPPLIER',
      name: bannerName('sort-earlier'),
      position: 'SEARCH_SIDEBAR',
      sortIndex: 1,
    });
    expect(later.status).toBe(201);
    expect(earlier.status).toBe(201);

    const supplierFeed = await request(app.getHttpServer()).get(
      '/api/v1/public/partner-banners?partnerType=SUPPLIER&position=SEARCH_SIDEBAR',
    );
    const names = supplierFeed.body.items.map((item: { name: string }) => item.name);
    const ours = names.filter(
      (name: string) => name === later.body.name || name === earlier.body.name,
    );
    expect(ours).toEqual([earlier.body.name, later.body.name]);

    const shippingFeed = await request(app.getHttpServer()).get(
      '/api/v1/public/partner-banners?partnerType=SHIPPING&position=SEARCH_SIDEBAR',
    );
    expect(shippingFeed.body.items.map((item: { name: string }) => item.name)).not.toContain(
      earlier.body.name,
    );
  });
});
