import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Skeleton seed. Real reference data (admin, config, templates) lands in P3.12.
// Demo/sample data must never be seeded in production.
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('Production seed: no demo data. Use the dedicated production seed (P3.12).');
    return;
  }
  console.log('Dev seed skeleton: no sample data yet (see P3.12).');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
