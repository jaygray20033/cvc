# CVC – Kiến trúc nền tảng

Tài liệu này giúp người mới hiểu cách chạy và cấu trúc dự án. Đọc cùng `decisions.md` (các quyết định nghiệp vụ) và `erd.md` (khung dữ liệu).

## 1. Tổng quan

CVC gồm 3 dịch vụ chạy độc lập hoặc nối nhau: **Tìm nguồn hàng**, **Mua hộ**, **Bán giùm**. Repo này xây bản production từ một bản demo giao diện (`legacy/cvc-demo/`, chỉ tham chiếu).

Stack: pnpm monorepo · NestJS + Prisma + MySQL · React + Vite + TypeScript · Redis + BullMQ · Socket.IO · SeaweedFS/S3 · Docker Compose · Nginx.

**Vận hành thủ công (D13):** thanh toán/chi tiền kiểu P2P (chuyển khoản + ảnh minh chứng, admin duyệt), eKYC duyệt tay, vận chuyển tự đặt hãng ngoài + mốc nhập tay. Không cổng thanh toán, không webhook ngân hàng, không API hãng vận chuyển. Các tích hợp tự động nằm ở Backlog, để sẵn lớp adapter.

## 2. Cấu trúc thư mục

```
apps/
  api/            NestJS API + worker (BullMQ)
    src/
      common/     filter lỗi, logger, error codes, middleware dùng chung
      config/     validate env (Zod) + configuration factory
      ...         module nghiệp vụ thêm ở Phase 2+
    prisma/       schema.prisma, seed.ts, migrations/
    scripts/      prisma-reset.mjs (chặn reset ở production)
  web/            React + Vite
    src/api/      client type-safe sinh từ openapi.json
    public/       config.js (runtime config, ghi đè lúc container khởi động)
packages/
  shared/         enum + kiểu + schema Zod dùng chung (Role, Currency, ...)
infra/
  docker-compose.dev.yml   stack dev (mysql, redis, seaweedfs, mailpit, adminer, api, worker, web)
  docker-compose.prod.yml  stack production (chạy từ image, chỉ proxy publish port)
  nginx/          web.conf, proxy.conf, proxy-tls.conf
  mysql/          init-dev.sql (grant shadow DB cho Prisma)
  seaweedfs/      docker-entrypoint.sh (sinh config S3) + init-buckets.sh (tạo bucket)
  web/            docker-entrypoint.sh (sinh config.js)
  scripts/        build/export/import-images.sh, db-backup.sh, deploy.sh
docs/             decisions.md, architecture.md, erd.md, environments.md
legacy/cvc-demo/  bản demo gốc (read-only)
```

## 3. Sơ đồ module (runtime)

```
Browser ──> proxy (Nginx, TLS)
              ├── /            ──> web (Nginx static, SPA)
              ├── /api/v1/*    ──> api (NestJS)
              ├── /docs        ──> api (Swagger UI)
              ├── /health,/ready ─> api (probe)
              └── /socket.io/  ──> api (Socket.IO)

api ──> MySQL (Prisma)      api ──> Redis (BullMQ, cache)
api ──> SeaweedFS/S3 (file) worker ──> Redis (queue) ──> MySQL
```

Dev: Vite proxy `/api`, `/docs`, `/socket.io`, `/health` thẳng tới container `api` (không qua proxy Nginx).

## 4. Luồng dữ liệu chính (sẽ hiện thực ở Phase 2+)

- **Tìm nguồn:** khách gửi yêu cầu → CVC tìm nguồn → Deal Room (chat, mẫu, hợp đồng, tiến độ). Không lộ giá mua/NCC ngoài Deal Room.
- **Mua hộ:** CVC đăng lô → người tham gia mua số lượng hàng nguyên → theo dõi tồn kho/đối soát → hoàn giá trị hàng + 3% sau 45 ngày (theo điều kiện từng chương trình).
- **Bán giùm:** bên bán đăng ký nhận hàng → bán qua kênh riêng → đối soát doanh thu/khoản được hưởng.
- **Tiền (D13):** mọi thay đổi số dư đi qua sổ cái kép cân bằng nợ/có; chỉ ghi sổ khi admin duyệt minh chứng; idempotent; chống dùng lại ảnh (hash). Không sửa/xóa bút toán.

## 5. Quy ước

- **Đặt tên:** biến/hàm/bảng tiếng Anh; text người dùng tiếng Việt qua i18n. Bảng số nhiều snake_case (`@@map`), cột camelCase trong code (`@map`).
- **Tiền:** `Decimal` + cột `currency` (VND/CNY). Không dùng float.
- **Máy trạng thái:** bảng chuyển trạng thái tường minh trong `packages/shared`; mọi chuyển trạng thái qua một hàm kiểm tra (trạng thái, vai trò, guard) + ghi audit.
- **Phân quyền:** 7 vai trò (buyer, participant, retailer, supplier, sales, inspector, admin); mặc định từ chối; kiểm tra sở hữu bản ghi (chống IDOR).
- **Lỗi API:** `{ code, message, details?, requestId }`. Log JSON (pino), che dữ liệu nhạy cảm.
- **TypeScript:** strict, không `any` tùy tiện; validate input ở biên (Zod/DTO).

## 6. Cách chạy (Docker-only)

Máy dev chỉ cần **Docker + Git + editor**. Không cài Node/MySQL/Redis trên host.

```bash
# Dựng toàn bộ stack dev (lần đầu sẽ build image + install deps)
docker compose -f infra/docker-compose.dev.yml up -d
# hoặc: pnpm docker:up

# Xem log
docker compose -f infra/docker-compose.dev.yml logs -f api

# Lint / typecheck / test trong container
docker compose -f infra/docker-compose.dev.yml exec api pnpm lint
docker compose -f infra/docker-compose.dev.yml exec api pnpm test

# Migration + seed (dev)
docker compose -f infra/docker-compose.dev.yml run --rm api pnpm --filter api prisma:migrate
docker compose -f infra/docker-compose.dev.yml run --rm api pnpm --filter api prisma:seed
```

Địa chỉ dev: web `http://localhost:5180`, API `http://localhost:3000`, Swagger `http://localhost:3000/docs`, Adminer `http://localhost:8082`, Mailpit `http://localhost:8026`, SeaweedFS S3 `http://localhost:9000`.

Git hooks (husky + lint-staged + commitlint) chạy **trong container api** nên cần stack dev đang bật (`pnpm docker:up`) trước khi commit. Commit theo Conventional Commits kèm task ID, ví dụ `feat(P1.2): add lint tooling`.

Production: xem `environments.md` và `infra/scripts/deploy.sh` (backup → nạp image → migrate → up → health).

## 7. Biến môi trường

Xem `apps/api/.env.example` và `apps/web/.env.example`. API validate env bằng Zod lúc khởi động (thiếu biến → dừng, in tên biến). Web production đọc `config.js` sinh lúc container chạy (không build lại image theo môi trường).
