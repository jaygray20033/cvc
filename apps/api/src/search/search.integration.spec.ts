import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { RedisService } from '../redis/redis.service';
import { SearchService } from './search.service';

// Integration tests for MySQL FULLTEXT search (P2.23): diacritics-insensitive
// ("ao mua" finds "Áo mưa"), type filter, ranking and < 200 ms latency.
// RUN_DB_TESTS=1 required.
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === '1';
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

let app: INestApplication;
let redis: RedisService;
let search: SearchService;

const RUN_ID = String(Date.now());

describeDb('Search (integration: P2.23)', () => {
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health', 'ready'] });
    await app.init();
    redis = app.get(RedisService);
    search = app.get(SearchService);
  });

  beforeEach(async () => {
    await redis.deleteByPattern('*}:hits');
    await redis.deleteByPattern('*}:blocked');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeAll(async () => {
    // Seed: the DoD example plus filler documents.
    await search.upsert('product', `do-ao-mua-${RUN_ID}`, {
      title: 'Áo mưa gấp gọn',
      keywords: ['áo mưa', 'poncho', 'gấp gọn'],
      data: { sku: 'CVC-001' },
    });
    await search.upsert('product', `do-ao-mua-kid-${RUN_ID}`, {
      title: 'Áo mưa trẻ em',
      keywords: ['áo mưa học sinh'],
    });
    await search.upsert('product', `do-khac-${RUN_ID}`, {
      title: 'Máy hút bụi cầm tay',
      keywords: ['gia dụng', 'máy hút'],
    });
    for (let i = 0; i < 60; i += 1) {
      await search.upsert('product', `filler-${RUN_ID}-${i}`, {
        title: `Bộ đồ bếp số ${i}`,
        keywords: ['gia dụng', 'nồi', 'chảo'],
      });
    }
    // Unpublished doc must not surface.
    await search.upsert('product', `hidden-${RUN_ID}`, {
      title: 'Áo mưa bản nháp',
      status: 'unpublished',
    });
  });

  it('searching without diacritics finds the Vietnamese title ("ao mua" -> "Áo mưa")', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/search?q=ao mua&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.tookMs).toBeLessThan(200);
    const titles = (res.body.items as Array<{ title: string }>).map((i) => i.title);
    expect(titles[0]).toContain('Áo mưa');
    expect(titles.some((t) => t.includes('Áo mưa gấp gọn'))).toBe(true);
    // Draft is excluded.
    expect(titles.some((t) => t.includes('bản nháp'))).toBe(false);
  }, 20000);

  it('searching WITH diacritics works too ("mưa")', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/search?q=m%C6%B0a&limit=10');
    expect(res.status).toBe(200);
    const titles = (res.body.items as Array<{ title: string }>).map((i) => i.title);
    expect(titles.some((t) => t.includes('Áo mưa'))).toBe(true);
  }, 20000);

  it('type filter narrows to the requested entityType', async () => {
    await search.upsert('supplier', `sup-test-${RUN_ID}`, { title: 'Áo mưa之家有限公司' });
    const res = await request(app.getHttpServer()).get(
      `/api/v1/search?q=ao mua&type=product&limit=10`,
    );
    const types = new Set(
      (res.body.items as Array<{ entityType: string }>).map((i) => i.entityType),
    );
    expect(types.has('supplier')).toBe(false);
    expect([...types].every((t) => t === 'product')).toBe(true);
  }, 20000);

  it('queries shorter than the minimum return no results', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/search?q=a');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('unpublish/remove drops a document from results', async () => {
    await search.upsert('product', `temp-${RUN_ID}`, { title: 'Áo mưa đặc biệt removable' });
    // "removable" is unique to this doc; other "ao mua" docs still match the
    // broader query, so assert on the specific title instead.
    const before = await search.search('removable');
    expect(before.items.some((item) => item.title.includes('removable'))).toBe(true);

    await search.remove('product', `temp-${RUN_ID}`);
    const after = await search.search('removable');
    expect(after.items.some((item) => item.title.includes('removable'))).toBe(false);
  }, 20000);
});
