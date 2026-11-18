import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

// P3.12 seed.
// - dev/staging: demo dataset ported from legacy/cvc-demo Ma-nguon domain.js
//   seed(): 18 suppliers, 30 products, 20 stores, 3 campaigns, 2
//   participations, 4 allocations, 4 sales + matching inventory.
// - production: only the bootstrap admin, roles, system settings and the
//   FX rate — never demo data.
const prisma = new PrismaClient();

// Argon2id options mirror src/auth/password.service.ts.
const ARGON2_OPTIONS = { timeCost: 2, memoryCost: 19456, parallelism: 1 } as const;

const DEMO_NOTE = 'DEMO';

// --- legacy domain.js catalog (30 items; price is the CNY reference) ---
const catalog: [string, string, number, number][] = [
  ['Áo mưa bộ phản quang', 'May mặc', 28, 500],
  ['Smart Glasses AI G2', 'Điện tử', 165, 100],
  ['Tã em bé AirSoft M60', 'Mẹ & bé', 32, 200],
  ['Bộ hộp thực phẩm 5 món', 'Gia dụng', 22, 200],
  ['Bình giữ nhiệt 600 ml', 'Hàng tiêu dùng', 35, 100],
  ['Tai nghe không dây T12', 'Điện tử', 58, 100],
  ['Áo polo cotton basic', 'May mặc', 38, 300],
  ['Giày thể thao Urban', 'Giày dép', 68, 120],
  ['Xe đồ chơi lắp ráp', 'Đồ chơi', 26, 240],
  ['Túi giấy kraft có quai', 'Bao bì', 2.8, 1000],
  ['Bộ cọ trang điểm 8 cây', 'Mỹ phẩm/phụ kiện', 19, 200],
  ['Khăn ướt em bé 80 tờ', 'Mẹ & bé', 8, 500],
  ['Đèn bàn LED học tập', 'Điện tử', 42, 150],
  ['Áo khoác gió 2 lớp', 'May mặc', 56, 300],
  ['Dép quai ngang EVA', 'Giày dép', 16, 360],
  ['Chảo chống dính 26 cm', 'Gia dụng', 44, 120],
  ['Gấu bông cotton 35 cm', 'Đồ chơi', 28, 200],
  ['Hộp carton đóng hàng', 'Bao bì', 3.5, 1000],
  ['Gương trang điểm để bàn', 'Mỹ phẩm/phụ kiện', 21, 200],
  ['Túi rác cuộn tự hủy', 'Hàng tiêu dùng', 5, 1000],
  ['Bình sữa PPSU 240 ml', 'Mẹ & bé', 36, 240],
  ['Pin dự phòng 10.000 mAh', 'Điện tử', 72, 100],
  ['Áo thun cổ tròn 220 gsm', 'May mặc', 24, 500],
  ['Giày trẻ em Flex', 'Giày dép', 39, 240],
  ['Kệ bếp 2 tầng', 'Gia dụng', 49, 100],
  ['Bộ xếp hình gỗ', 'Đồ chơi', 32, 200],
  ['Túi zip thực phẩm', 'Bao bì', 0.8, 3000],
  ['Dây buộc tóc lụa', 'Mỹ phẩm/phụ kiện', 4.5, 500],
  ['Khăn microfiber 30 × 30', 'Hàng tiêu dùng', 3.8, 1000],
  ['Bỉm quần AirSoft L48', 'Mẹ & bé', 34, 200],
];
const productSpecs = [
  'Vải polyester 210T • đường may ép nhiệt • S–XXL',
  'Bluetooth 5.3 • loa mở • pin 6 giờ • USB-C',
  '60 miếng/bịch • size M 6–11 kg • lõi SAP',
  'PP dùng cho thực phẩm • 5 dung tích • không BPA',
  'Inox 304 • nắp chống tràn • 600 ml',
  'Bluetooth 5.3 • hộp sạc USB-C • mic kép',
  'Cotton 95% • 5% spandex • S–3XL',
  'Đế EVA • upper mesh • size 36–44',
  'ABS • bộ 86 chi tiết • từ 6 tuổi',
  'Kraft 150 gsm • 26 × 32 cm • in logo',
  'Lông tổng hợp • cán nhôm • kèm túi',
  '80 tờ • không hương liệu • vải không dệt',
  '3 nhiệt độ màu • 5W • USB-C',
  'Polyester • cản gió • size S–XXL',
  'EVA nguyên khối • size 36–45',
  'Hợp kim nhôm • đáy từ • tay cầm cách nhiệt',
  'Vải nhung • bông PP • 35 cm',
  'Carton 3 lớp • 25 × 20 × 15 cm',
  'Khung ABS • xoay 180° • đường kính 16 cm',
  'PE pha tinh bột • 45 × 55 cm • 30 túi',
  'PPSU • núm silicone • 240 ml',
  'Li-ion • PD 20W • USB-C • 10.000 mAh',
  'Cotton • 220 gsm • 8 màu • in OEM',
  'Đế TPR • khóa dán • size 22–32',
  'Thép sơn tĩnh điện • 40 × 25 × 35 cm',
  'Gỗ sồi • 50 khối • từ 3 tuổi',
  'PE • 20 × 28 cm • zipper kép',
  'Satin • đường kính 10 cm • 6 màu',
  'Microfiber 300 gsm • 30 × 30 cm',
  '48 miếng/bịch • size L 9–14 kg • lõi SAP',
];

const supplierNames = [
  'Hải Châu Textile',
  'Shenzhen Vision Tech',
  'Phúc Kiến Baby Care',
  'Ningbo Homeware',
  'Zhejiang Daily Goods',
  'Dongguan Audio',
  'Quảng Châu Apparel',
  'Jinjiang Footwear',
  'Shantou Creative Toys',
  'Yiwu Packaging',
  'Guangzhou Beauty',
  'Quanzhou Family Care',
  'Foshan Lighting',
  'Suzhou Fabrics',
  'Wenzhou Footwear',
  'Yongkang Kitchen',
  'Chenghai Play',
  'Hangzhou Paper',
];
const supplierProvinces = [
  'Quảng Châu',
  'Thâm Quyến',
  'Phúc Kiến',
  'Ninh Ba',
  'Chiết Giang',
  'Đông Quản',
];

const cities = [
  'TP. Hồ Chí Minh',
  'Hà Nội',
  'Đà Nẵng',
  'Cần Thơ',
  'Bình Dương',
  'Đồng Nai',
  'Hải Phòng',
  'Huế',
  'Nha Trang',
  'Vũng Tàu',
];
const storeNames = [
  'Mẹ & Bé An Nhiên',
  'Cửa hàng Minh Anh',
  'Gia dụng Bảo Ngọc',
  'Mẹ & Bé Bông',
  'Siêu thị mini Phúc Lộc',
  'Tạp hóa Hồng Hà',
  'An Khang Mart',
  'Mẹ & Bé Mặt Trời',
  'Hoa Mai Store',
  'Tiện lợi Hưng Thịnh',
];

// System-wide settings (dev + production bootstrap).
const systemSettings: { key: string; value: unknown }[] = [
  { key: 'fx.cny_vnd.default', value: { rate: 3600 } },
  { key: 'campaign.deposit_rate', value: { rate: 0.3 } },
  { key: 'campaign.return_after_days', value: { days: 45 } },
  { key: 'campaign.return_bonus_rate', value: { rate: 0.03 } },
  { key: 'sourcing.horizon_days', value: { days: 30 } },
  { key: 'sourcing.default_lead_days', value: { days: 25 } },
];

async function ensureAdmin(): Promise<{ id: string }> {
  // Bootstrap admin; password is dev-only and printed in README/dev docs.
  const email = 'admin@cvc.dev';
  const passwordHash = await hash('Dev@123456', ARGON2_OPTIONS);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, emailVerifiedAt: new Date() },
  });
  for (const role of ['admin', 'admin_super']) {
    await prisma.userRole.upsert({
      where: { userId_role: { userId: admin.id, role } },
      update: {},
      create: { userId: admin.id, role },
    });
  }
  return admin;
}

async function ensureSettings(): Promise<void> {
  for (const setting of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting as object },
    });
  }
  // Latest CNY -> VND reference rate.
  const rateKey = 'fx.cny_vnd.default';
  const existing = await prisma.exchangeRate.findFirst({
    where: { baseCode: 'CNY', quoteCode: 'VND' },
    orderBy: { effectiveAt: 'desc' },
  });
  if (!existing) {
    await prisma.exchangeRate.create({
      data: {
        baseCode: 'CNY',
        quoteCode: 'VND',
        rate: 3600,
        effectiveAt: new Date(),
        source: 'MANUAL',
      },
    });
  }
  void rateKey;
}

async function ensureSupplier(name: string, index: number): Promise<{ id: string }> {
  const found = await prisma.supplier.findFirst({ where: { name } });
  if (found) return found;
  return prisma.supplier.create({
    data: {
      name,
      province: supplierProvinces[index % supplierProvinces.length],
      country: 'CN',
      notes: `Ngành nghề ${4 + (index % 9)} năm • công suất ${20000 + index * 5000}/tháng • lead ${15 + (index % 5) * 3} ngày • thanh toán 30% cọc / 70% sau QC • hồ sơ minh họa, chưa xác minh • OEM ${index % 3 !== 2 ? 'có' : 'không'} / ODM ${index % 2 === 0 ? 'có' : 'không'}`,
    },
  });
}

async function seedDemo(): Promise<void> {
  const admin = await ensureAdmin();
  const adminId = admin.id;

  // Demo accounts (store owners + participants), password Dev@123456.
  const passwordHash = await hash('Dev@123456', ARGON2_OPTIONS);
  const demoEmails = [
    'demo-store-1@cvc.dev',
    'demo-store-2@cvc.dev',
    'demo-store-3@cvc.dev',
    'demo-participant-1@cvc.dev',
    'demo-participant-2@cvc.dev',
  ];
  const demoUsers: { id: string }[] = [];
  for (const email of demoEmails) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash, emailVerifiedAt: new Date() },
    });
    demoUsers.push(user);
  }

  // Suppliers (18) + catalog (9 categories / 30 products).
  const suppliers: { id: string }[] = [];
  for (let i = 0; i < supplierNames.length; i++) {
    suppliers.push(await ensureSupplier(supplierNames[i], i));
  }

  const categoryNames = [...new Set(catalog.map((p) => p[1]))];
  const categories = new Map<string, string>();
  for (let i = 0; i < categoryNames.length; i++) {
    const name = categoryNames[i];
    const slug =
      `demo-${name.toLowerCase().replace(/[^a-z0-9àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ-\s]/g, '')}`.replace(
        /\s+/g,
        '-',
      );
    const category = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { name, slug, sortIndex: i },
    });
    categories.set(name, category.id);
  }

  const products: { id: string }[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const [name, categoryName, price, moq] = catalog[i];
    const sku = `CVC-${String(i + 1).padStart(3, '0')}`;
    const product = await prisma.product.upsert({
      where: { sku },
      update: {},
      create: {
        categoryId: categories.get(categoryName)!,
        sku,
        name,
        spec: productSpecs[i],
        moq,
        leadTimeDays: 15 + (i % 5) * 3,
        priceRef: price,
        currency: 'CNY',
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });
    products.push(product);
    // Per-supplier cost price (internal only, CNY).
    const supplier = suppliers[i % suppliers.length];
    await prisma.supplierProduct.upsert({
      where: { supplierId_productId: { supplierId: supplier.id, productId: product.id } },
      update: {},
      create: {
        supplierId: supplier.id,
        productId: product.id,
        costPrice: price,
        currency: 'CNY',
        moq,
      },
    });
  }

  // Stores (20), first 16 active, the rest pending/inactive as in the demo.
  const stores: { id: string }[] = [];
  for (let i = 0; i < 20; i++) {
    const name = storeNames[i % 10] + (i > 9 ? ' 2' : '');
    const store = await prisma.store.upsert({
      where: { code: `ST${String(i + 1).padStart(2, '0')}` },
      update: {},
      create: {
        ownerId: demoUsers[i % 3].id,
        name,
        code: `ST${String(i + 1).padStart(2, '0')}`,
        province: cities[i % 10],
        address: `${12 + i * 7} Nguyễn Văn Linh`,
        phone: `090000${String(1000 + i)}`,
        isActive: i < 16,
      },
    });
    stores.push(store);
  }

  // Campaigns (3) ported from domain.js: CP01 open at registration,
  // CP02/CP03 finished and distributed.
  type CampaignSeed = {
    name: string;
    productIndex: number;
    capacity: number;
    stage: 'REGISTRATION' | 'DONE';
    status: 'ACTIVE' | 'CLOSED';
    retail: number;
    cost: number;
    commission: number;
    logistics: number;
    storage: number;
    deadline: string;
  };
  const campaignSeeds: CampaignSeed[] = [
    {
      name: 'Container tã em bé AirSoft size M/L/XL',
      productIndex: 2,
      capacity: 7200,
      stage: 'REGISTRATION',
      status: 'ACTIVE',
      retail: 169000,
      cost: 112000,
      commission: 0.1,
      logistics: 2000,
      storage: 500,
      deadline: '2026-11-05',
    },
    {
      name: 'Container bộ hộp thực phẩm 5 món',
      productIndex: 3,
      capacity: 3000,
      stage: 'DONE',
      status: 'CLOSED',
      retail: 129000,
      cost: 82000,
      commission: 0.12,
      logistics: 1500,
      storage: 400,
      deadline: '2026-10-10',
    },
    {
      name: 'Container bình giữ nhiệt 600 ml',
      productIndex: 4,
      capacity: 2000,
      stage: 'DONE',
      status: 'CLOSED',
      retail: 189000,
      cost: 125000,
      commission: 0.08,
      logistics: 2000,
      storage: 500,
      deadline: '2026-09-10',
    },
  ];
  const campaigns: { id: string; productIndex: number; cost: number }[] = [];
  for (const seed of campaignSeeds) {
    const found = await prisma.campaign.findFirst({ where: { name: seed.name } });
    const campaign =
      found ??
      (await prisma.campaign.create({
        data: {
          name: seed.name,
          capacity: seed.capacity,
          stage: seed.stage,
          status: seed.status,
          deadline: new Date(seed.deadline),
          supplierId: suppliers[seed.productIndex % suppliers.length].id,
          createdById: adminId,
          costPrice: seed.cost,
          retailPrice: seed.retail,
          currency: 'VND',
          participantShareRate: 0,
          retailerShareRate: seed.commission,
          cvcFeeRate: 0.05,
          logisticsCost: seed.logistics,
          storageCost: seed.storage,
          otherCost: 0,
          depositRate: 0.3,
          returnAfterDays: 45,
          returnBonusRate: 0.03,
        },
      }));
    campaigns.push({ id: campaign.id, productIndex: seed.productIndex, cost: seed.cost });
    await prisma.campaignLine.upsert({
      where: {
        campaignId_productId: {
          campaignId: campaign.id,
          productId: products[seed.productIndex].id,
        },
      },
      update: {},
      create: {
        campaignId: campaign.id,
        productId: products[seed.productIndex].id,
        plannedQty: seed.capacity,
        unitPrice: seed.retail,
      },
    });
  }

  // Participations: the two demo partners bought the CP02/CP03 containers.
  const participationSeeds = [
    { campaignIndex: 1, userId: demoUsers[3].id, qty: 3000 },
    { campaignIndex: 2, userId: demoUsers[4].id, qty: 2000 },
  ];
  for (const seed of participationSeeds) {
    const campaign = campaigns[seed.campaignIndex];
    await prisma.participation.upsert({
      where: { campaignId_userId: { campaignId: campaign.id, userId: seed.userId } },
      update: {},
      create: {
        campaignId: campaign.id,
        userId: seed.userId,
        amountPaid: seed.qty * campaign.cost,
        unitsBought: seed.qty,
        status: 'COMPLETED',
      },
    });
  }

  // Allocations (4, all received) + goods flow into inventory.
  const allocationSeeds = [
    { campaignIndex: 1, storeIndex: 1, qty: 700, days: 28 },
    { campaignIndex: 1, storeIndex: 2, qty: 700, days: 28 },
    { campaignIndex: 2, storeIndex: 0, qty: 200, days: 4 },
    { campaignIndex: 2, storeIndex: 1, qty: 300, days: 4 },
  ];
  const lotsByProduct = new Map<number, string>(); // productIndex -> lotId
  for (const seed of allocationSeeds) {
    const campaign = campaigns[seed.campaignIndex];
    const store = stores[seed.storeIndex];
    const productId = products[campaign.productIndex].id;
    const existing = await prisma.allocation.findFirst({
      where: { campaignId: campaign.id, storeId: store.id, note: DEMO_NOTE },
    });
    if (existing) continue;
    const allocation = await prisma.allocation.create({
      data: {
        campaignId: campaign.id,
        storeId: store.id,
        allocatedById: adminId,
        status: 'RECEIVED',
        allocatedAt: new Date(Date.now() - seed.days * 86400000),
        receivedAt: new Date(Date.now() - seed.days * 86400000 + 86400000),
        note: DEMO_NOTE,
      },
    });
    await prisma.allocationLine.create({
      data: { allocationId: allocation.id, productId, quantity: seed.qty },
    });

    // Inventory: one lot per (campaign, product); movements + balance follow.
    let lotId = lotsByProduct.get(campaign.productIndex);
    if (!lotId) {
      const lot = await prisma.inventoryLot.create({
        data: { productId, campaignId: campaign.id, lotNo: `LOT-${campaign.productIndex + 1}` },
      });
      lotId = lot.id;
      lotsByProduct.set(campaign.productIndex, lotId);
    }
    await prisma.inventoryMovement.create({
      data: {
        lotId,
        storeId: store.id,
        type: 'RECEIVE',
        quantity: seed.qty,
        referenceType: 'allocation',
        referenceId: allocation.id,
        note: DEMO_NOTE,
        createdById: adminId,
      },
    });
    await prisma.inventoryBalance.upsert({
      where: { lotId_storeId: { lotId, storeId: store.id } },
      update: { quantity: { increment: seed.qty } },
      create: { lotId, storeId: store.id, quantity: seed.qty },
    });
  }

  // Sales (4 demo transactions) + stock out + resale listings.
  const saleSeeds = [
    { campaignIndex: 2, storeIndex: 0, qty: 50, price: 189000, at: '2026-10-15T09:00:00+07:00' },
    { campaignIndex: 2, storeIndex: 1, qty: 130, price: 189000, at: '2026-10-16T10:00:00+07:00' },
    { campaignIndex: 1, storeIndex: 1, qty: 140, price: 129000, at: '2026-10-17T09:00:00+07:00' },
    { campaignIndex: 1, storeIndex: 2, qty: 70, price: 129000, at: '2026-10-18T09:00:00+07:00' },
  ];
  for (const seed of saleSeeds) {
    const campaign = campaigns[seed.campaignIndex];
    const store = stores[seed.storeIndex];
    const productId = products[campaign.productIndex].id;
    const existing = await prisma.sale.findFirst({
      where: { storeId: store.id, soldAt: new Date(seed.at), note: DEMO_NOTE },
    });
    if (existing) continue;
    const sale = await prisma.sale.create({
      data: {
        storeId: store.id,
        campaignId: campaign.id,
        soldById: demoUsers[stores.indexOf(store) % 3].id,
        soldAt: new Date(seed.at),
        totalAmount: seed.qty * seed.price,
        note: DEMO_NOTE,
      },
    });
    await prisma.saleLine.create({
      data: { saleId: sale.id, productId, quantity: seed.qty, unitPrice: seed.price },
    });
    const lotId = lotsByProduct.get(campaign.productIndex);
    if (lotId) {
      await prisma.inventoryMovement.create({
        data: {
          lotId,
          storeId: store.id,
          type: 'ISSUE',
          quantity: -seed.qty,
          referenceType: 'sale',
          referenceId: sale.id,
          note: DEMO_NOTE,
          createdById: adminId,
        },
      });
      await prisma.inventoryBalance.upsert({
        where: { lotId_storeId: { lotId, storeId: store.id } },
        update: { quantity: { decrement: seed.qty } },
        create: { lotId, storeId: store.id, quantity: -seed.qty },
      });
    }
  }

  // Retail listings for the distributed campaigns (P3.7 demo).
  for (const seed of allocationSeeds) {
    const campaign = campaigns[seed.campaignIndex];
    const storeIndex = seed.storeIndex;
    const store = stores[storeIndex];
    const existing = await prisma.resaleListing.findFirst({
      where: { storeId: store.id, campaignId: campaign.id },
    });
    if (existing) continue;
    const product = products[campaign.productIndex];
    const price = campaignSeeds[seed.campaignIndex].retail;
    await prisma.resaleListing.create({
      data: {
        campaignId: campaign.id,
        productId: product.id,
        storeId: store.id,
        title: `Bán lẻ ${catalog[campaign.productIndex][0]} (ST${String(storeIndex + 1).padStart(2, '0')})`,
        salePrice: price,
        retailerShareAmount: Math.round(price * campaignSeeds[seed.campaignIndex].commission),
        quantityRemaining: seed.qty,
      },
    });
  }

  console.log(
    'Dev seed done: 18 suppliers, 30 products, 20 stores, 3 campaigns, 2 participations, 4 allocations, 4 sales.',
  );
}

async function main(): Promise<void> {
  // Bootstrap data for every environment (admin, roles, settings, FX rate).
  await ensureAdmin();
  await ensureSettings();

  if (process.env.NODE_ENV === 'production') {
    console.log('Production seed done: admin + roles + system settings only (no demo data).');
    return;
  }
  await seedDemo();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
