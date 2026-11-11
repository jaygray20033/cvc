# CLAUDE.md – CVC (Tìm nguồn hàng · Mua hộ · Bán giùm)

Tài liệu hướng dẫn cho Claude Code khi làm việc trong repo này. Đọc hết trước khi sửa bất cứ thứ gì.

## 1. Dự án là gì

CVC là nền tảng thương mại gồm 3 dịch vụ chạy độc lập hoặc nối nhau:

1. **Tìm nguồn hàng**: khách gửi yêu cầu (sản phẩm, ảnh, thông số, số lượng, điều kiện) → CVC hỗ trợ tìm nguồn, giới thiệu nhà cung cấp → hai bên thương lượng trong **Deal Room** riêng (chat, mẫu, thông số, hợp đồng, tiến độ). CVC **không trực tiếp mua bán hàng thay khách** (vai trò hỗ trợ kết nối; luồng tiền chính thức chờ quyết định D1/D3).
2. **Mua hộ**: CVC khảo sát và đăng **lô/container**. Người tham gia mua **số lượng hàng nguyên** tương ứng số tiền (không mua cả container). Hàng tự kinh doanh hoặc gửi qua Bán giùm. Sau **45 ngày**, phần hàng đủ điều kiện được hoàn giá trị hàng + **3% chỉ tính trên giá trị hàng được hoàn** (điều kiện theo từng chương trình).
3. **Bán giùm**: cửa hàng/hộ kinh doanh/cá nhân chọn mặt hàng, xem giá bán và khoản được hưởng, đăng ký số lượng nhận bán, bán qua kênh của mình, đối soát với CVC.

Repo này **xây bản production** từ một bản demo giao diện. Bản demo nằm ở `legacy/cvc-demo/` (read-only, chỉ để tham chiếu logic và UX). Demo không có backend: mọi dữ liệu nằm trong `localStorage`, hợp đồng/thanh toán/QR/camera/vận chuyển đều **giả lập**.

**Vận hành thủ công và Docker (đã chốt, quyết định D13):**
1. Thanh toán/chi tiền **kiểu P2P**: người dùng chuyển khoản + **tải ảnh minh chứng**, admin tài chính đối chiếu sao kê và duyệt. Không cổng thanh toán, không webhook ngân hàng.
2. **eKYC duyệt tay** bằng ảnh CCCD mặt trước/sau + ảnh chân dung cầm CCCD. Không tích hợp eKYC.
3. Vận chuyển do NCC/CVC/khách **tự đặt hãng ngoài**; hệ thống lưu hãng, mã vận đơn, link tra cứu và **mốc nhập tay**. Không tích hợp API hãng.
4. **Toàn bộ hệ thống chạy bằng Docker**; deploy bằng image build sẵn hoặc file nén `.tar.gz`.
Các tích hợp tự động nằm ở Backlog; để sẵn lớp adapter để cắm sau.

## 2. Nguồn tham chiếu trong demo (đọc trước khi port)

| Cần port | Đọc file |
|---|---|
| Vai trò, bước quy trình, dữ liệu mẫu, nghiệp vụ dùng chung | `legacy/cvc-demo/Ma-nguon/dist/domain.js` |
| Tìm nguồn: Deal Room, mẫu, hợp đồng, thanh toán, khiếu nại | `buyer-flow.js`, `buyer-ui.js`, `buyer-addons.js` |
| Mua hộ: tham gia lô, ví, hoàn 45 ngày, tồn kho | `participant-flow.js`, `participant-ui.js` |
| Nhà cung cấp, RFQ, báo giá, concierge | `vendor-flow.js`, `vendor-ui.js` |
| Danh mục công khai, banner đối tác | `sourcing-data.js`, `sourcing-ui.js`, `service-banners.js` |
| Sản phẩm và bộ ảnh | `reference-catalog.js`, `reference-galleries.js` |
| Màn hình và điều hướng | `app.js` (`navItems`, `roleNav`, từng hàm màn hình) |
| Test mô tả hành vi mong đợi | `tests.mjs`, `buyer-tests.mjs`, `payment-cases-tests.mjs`, `participant-tests.mjs`, `sourcing-tests.mjs`, `vendor-tests.mjs`, `concierge-tests.mjs` |
| Ghi chú mô hình của chủ dự án | `legacy/cvc-demo/Ma-nguon/GHI-CHU-PHAT-TRIEN.md` |

**Quy tắc:** logic trong demo là *đặc tả hành vi*, không phải code để copy nguyên. Port sang TypeScript có kiểu, có validate, có test. Test của demo phải được port thành test của backend mới.

### Những chỗ demo KHÔNG đúng với mô hình chính thức (đừng port nguyên)
- Tỷ lệ cố định tự bán 20% / mua hộ 10% / bán giùm 10% → phải **cấu hình theo từng lô/sản phẩm**.
- Luồng tìm nguồn có bước khách trả CVC → CVC giữ tiền → chuyển nhà cung cấp → phụ thuộc quyết định D1/D3, **không tự cài đặt khi chưa chốt**.
- Có **hai bản quy trình đơn** không khớp: `orderSteps` (10 bước, `domain.js`) và `stages` (8 bước, `buyer-flow.js`) → theo quyết định D7.
- Bộ chuyển vai trò DEMO, màn "Thiết lập demo", các hàm `setAuto`, `pump`, `simulateDay` → chỉ dùng cho test/staging, **không có ở production**.
- Tên đối tác trong banner và dữ liệu 30 sản phẩm/18 NCC/20 cửa hàng chỉ là minh họa.

## 3. Stack và cấu trúc repo

- Monorepo (pnpm workspaces).
- **Toàn bộ chạy bằng Docker** (dev và production), xem mục 4.
- `apps/api`: **NestJS + TypeScript + Prisma + MySQL**, Redis + BullMQ (job nền), Socket.IO (realtime), S3/SeaweedFS (file).
- `apps/web`: **React + Vite + TypeScript**, React Router, TanStack Query, React Hook Form + Zod, Tailwind.
- `packages/shared`: kiểu dữ liệu, enum trạng thái, schema Zod dùng chung api/web.
- `infra/`: Dockerfile/compose (dev + prod), proxy, script build/nén image, deploy, rollback, backup.
- `docs/`: `decisions.md`, `architecture.md`, `erd.md`, `integrations/`, `runbook.md`.
- `legacy/cvc-demo/`: bản demo gốc (read-only).

Nếu cần đổi stack, hỏi trước. Không tự ý thêm framework/thư viện lớn.

## 4. Chạy và build bằng Docker (bắt buộc)

**Mọi thứ chạy trong Docker.** Máy dev chỉ cần Docker + Git. Không cài MySQL/Redis/Node trực tiếp trên host, không chạy `pnpm dev` ngoài container.

```bash
# Dev
docker compose -f infra/docker-compose.dev.yml up -d      # mysql, redis, seaweedfs, mailpit, api, worker, web
docker compose -f infra/docker-compose.dev.yml logs -f api
docker compose -f infra/docker-compose.dev.yml exec api pnpm lint
docker compose -f infra/docker-compose.dev.yml exec api pnpm test
docker compose -f infra/docker-compose.dev.yml exec web pnpm test
docker compose -f infra/docker-compose.dev.yml run --rm api pnpm prisma migrate dev
docker compose -f infra/docker-compose.dev.yml run --rm api pnpm prisma db seed

# Build và nén image production
./infra/scripts/build-images.sh <tag>
./infra/scripts/export-images.sh <tag>      # -> cvc-images-<tag>.tar.gz + SHA-256

# Chạy staging/production từ image
docker compose -f infra/docker-compose.prod.yml run --rm migrate
docker compose -f infra/docker-compose.prod.yml up -d
```

Quy tắc Docker:
- Thêm dependency: sửa `package.json` + lockfile rồi **rebuild image**.
- Image production không chứa `.env`, test, devDependencies; chạy non-root; **cùng một image** chạy staging và production, chỉ khác env.
- Cấu hình runtime của web đi qua `config.js` sinh lúc container khởi động (không build lại image cho từng môi trường).
- Mọi service có `healthcheck`; ở production chỉ `proxy` publish 80/443, mysql/redis/seaweedfs không publish port.
- **Cấm** `docker volume prune` và `prisma migrate reset` trên production. Migration chạy bằng service `migrate`, không tự chạy khi api khởi động.
(Cập nhật mục này khi script thật đã có.)

## 5. Cách làm việc (quan trọng)

1. Mỗi lần chỉ làm **một task** trong `todo.md`, gọi bằng ID (ví dụ `P4.31`). Đọc phần mô tả, bước, endpoint, DoD của task đó.
2. **Đọc code thật trước khi đề xuất hoặc sửa.** Không đoán nội dung file. Với task port, đọc file demo tương ứng ở bảng mục 2.
3. **Trước mọi thao tác phá hủy** (xóa file/dữ liệu, `prisma migrate reset`, `git reset --hard`, drop bảng, đổi tên cột có dữ liệu, sửa migration đã chạy): **hiển thị diff/kế hoạch và chờ xác nhận**.
4. Migration chỉ thêm mới; không sửa migration đã áp dụng. Thay đổi lớn: tạo migration mới.
5. Xong một task: chạy lint + typecheck + test liên quan, tick `[x]` trong file todo, commit riêng (một task một commit).
6. Gặp điểm mơ hồ về **nghiệp vụ, tiền, pháp lý** (liên quan D1–D12): **dừng và hỏi**, không tự chọn. Ghi câu trả lời vào `docs/decisions.md`.
7. Task đánh dấu 🔒 chưa được làm cho đến khi quyết định liên quan ở `docs/decisions.md` đã chốt.
8. Task đánh dấu 🔌 làm qua lớp adapter, có mock; không gọi dịch vụ thật khi test.
9. Không tạo file ngoài phạm vi task. Không "tiện tay" refactor chỗ không liên quan.
10. Chạy mọi lệnh trong container (mục 4); không cài thêm dịch vụ trực tiếp lên host.

## 6. Quy tắc code

### Chung
- TypeScript `strict`. Không dùng `any` trừ khi có comment lý do.
- Tên biến/hàm/bảng bằng tiếng Anh; text hiển thị cho người dùng bằng tiếng Việt qua i18n (không hard-code trong component).
- Validate mọi input ở biên (DTO/Zod). Không tin dữ liệu từ client.
- Lỗi API theo format chuẩn `{ code, message, details?, requestId }`.
- Không log dữ liệu nhạy cảm (CCCD, số tài khoản, token, OTP).
- Không commit secret; mọi cấu hình qua env, có `.env.example`.

### Tiền (nghiêm ngặt)
- **Không dùng `float`/`number` cho tiền.** Dùng `Decimal` (Prisma) / lưu số nguyên đơn vị nhỏ nhất; mọi bảng tiền có cột `currency` (`VND`/`CNY`).
- Mọi thay đổi tiền đi qua **sổ cái kép** (`LedgerEntry`): mỗi giao dịch tạo các bút toán **cân bằng nợ/có**. **Không có API sửa/xóa bút toán**; sai thì tạo bút toán đảo.
- Mọi API tạo giao dịch tiền nhận **Idempotency-Key**; gọi lại cùng key không tạo giao dịch thứ hai.
- Mọi thao tác trừ/cộng số dư hoặc hạn mức nằm trong **một transaction DB** với khóa hàng hoặc cập nhật nguyên tử (`UPDATE ... WHERE remaining >= qty`). Test race condition cho các chỗ này.
- **Thanh toán và chi tiền là THỦ CÔNG (đã chốt):** người dùng chuyển khoản + **tải ảnh minh chứng**; admin tài chính đối chiếu sao kê và duyệt. Chi tiền (NCC, hoàn tiền, rút tiền) do admin chuyển khoản ngoài hệ thống rồi tải ảnh minh chứng chi. **Chỉ ghi sổ cái khi duyệt**, duyệt phải idempotent; chống dùng lại ảnh (hash); không tích hợp cổng thanh toán/webhook ở bản này.
- Số tiền lớn: cần duyệt hai lớp (xem phase 5/9).

### Máy trạng thái
- Order, Campaign, Claim, Sample, Quote/RFQ có **bảng chuyển trạng thái tường minh** trong `packages/shared`. Mọi chuyển trạng thái đi qua một hàm duy nhất kiểm tra: trạng thái hiện tại hợp lệ, vai trò được phép, điều kiện (guard). Cấm cập nhật cột `status` trực tiếp ở nơi khác.
- Mỗi chuyển trạng thái ghi `OrderEvent`/audit log (ai, khi nào, từ → sang, lý do).

### Phân quyền
- 7 vai trò: `buyer` (khách tìm nguồn), `participant` (bên mua hộ), `retailer` (bên bán giùm), `supplier`, `sales`, `inspector`, `admin`.
- Mỗi endpoint khai báo rõ vai trò **và** kiểm tra quyền sở hữu bản ghi (chống IDOR). Mặc định **từ chối**.
- Nhà cung cấp và danh mục công khai: **không lộ giá mua và thông tin nhà cung cấp** ngoài Deal Room.

### Frontend
- Không dùng `localStorage` làm nguồn dữ liệu nghiệp vụ (chỉ cho tùy chọn giao diện).
- Mọi màn hình có đủ trạng thái: loading (skeleton), empty, error (có nút thử lại), no-permission.
- Form: React Hook Form + Zod, thông báo lỗi tiếng Việt, khóa nút khi đang gửi, không gửi trùng.
- Responsive từ 360px; POS và kiểm tra thực địa phải dùng tốt trên điện thoại.
- Không có chữ "DEMO", không có công cụ đổi vai trò, không có số liệu giả trong bản production.
- Tiền hiển thị qua một hàm format duy nhất theo locale và currency.
- Cảnh báo rủi ro Mua hộ phải hiển thị rõ; **không viết câu cam kết lợi nhuận**.

## 7. Kiểm thử

- Mỗi module backend có unit test (domain/service) + integration test (API + DB thật bằng container).
- Port test demo làm nền; thêm test cho: ledger luôn cân bằng, ví không âm, idempotency, race condition hạn mức cuối, chuyển trạng thái sai, IDOR.
- Frontend: component test cho form quan trọng; E2E Playwright cho luồng chính (Tìm nguồn trọn vòng, Mua hộ đến hoàn 45 ngày, Bán giùm đến đối soát, khiếu nại, rút tiền).
- Module tiền và hợp đồng có ngưỡng coverage tối thiểu; CI chặn merge nếu dưới ngưỡng.

## 8. Git

- Nhánh: `feat/<task-id>-<mô-tả-ngắn>`, `fix/...`.
- Commit: `feat(P4.31): join campaign with whole-unit quantity` (kèm task ID).
- Không force-push `main`. Không commit file `.env`, dump DB, file khách hàng.

## 9. Định nghĩa "xong" cho một task

- [ ] Chạy đúng theo mô tả và DoD của task.
- [ ] Có test (hoặc ghi rõ vì sao không cần) và test xanh.
- [ ] Lint + typecheck sạch.
- [ ] Không còn TODO/console.log/dữ liệu giả.
- [ ] Tài liệu cập nhật nếu đổi API/schema/biến môi trường (`docs/`, Swagger, `.env.example`).
- [ ] Đã tick trong file todo và commit.

## 10. Không được làm

- Không tự chọn mô hình luồng tiền, bên ký hợp đồng, tỷ lệ lợi nhuận, điều kiện hoàn 45 ngày/3% khi chưa có quyết định trong `docs/decisions.md`.
- Không gọi dịch vụ bên thứ 3 thật (chữ ký số, SMS, email, hóa đơn điện tử) từ môi trường dev/test.
- Không tự thêm tích hợp cổng thanh toán, eKYC tự động hoặc API hãng vận chuyển (đã chốt làm thủ công, D13).
- Không xóa/sửa bút toán sổ cái, không sửa migration đã chạy.
- Không bỏ qua kiểm tra phân quyền "cho nhanh".
- Không đưa công cụ DEMO vào build production.
- Không dùng ảnh/nội dung từ demo cho bản bán (ảnh tham khảo từ nguồn bên ngoài, chưa có bản quyền).
