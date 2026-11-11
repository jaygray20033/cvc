# CVC – TODO tổng (build production, không phải MVP)

File này là **nguồn duy nhất**: mục lục, thứ tự làm, tiến độ, và chi tiết từng task (từ Phase 0 đến Phase 11) ở bên dưới.
Cách làm việc với Claude Code: xem `CLAUDE.md`.

Cách tick: đổi `[ ]` thành `[x]` ở **tiêu đề từng task** trong file phase (và ở các dòng L1–L8). Bảng tiến độ bên dưới cập nhật tay khi xong phase.

> **Đã chốt (D13):** (1) thanh toán/chi tiền làm **thủ công kiểu P2P**: chuyển khoản + **ảnh minh chứng**, admin duyệt; (2) **eKYC duyệt tay** bằng ảnh CCCD + ảnh chân dung; (3) **vận chuyển tự đặt hãng ngoài, tracking nhập tay**; (4) **toàn bộ chạy bằng Docker** (dev và production), deploy bằng image build sẵn hoặc file nén `.tar.gz`. Tích hợp tự động để ở Backlog.

Ký hiệu: `[ ]` chưa làm · `[x]` xong · 🔒 chờ quyết định Phase 0 · 🔌 phụ thuộc bên thứ 3 · ⚠️ rủi ro cao (tiền / pháp lý / dữ liệu).

## Mục lục phase

| Phase | Vị trí | Nội dung | Ghi chú |
|---|---|---|---|
| 0 | xem bên dưới | 12 quyết định nghiệp vụ, pháp lý | **Làm trước**, chặn các task 🔒 |
| 1 | xem bên dưới | Monorepo, **Docker cho tất cả**, CI, cấu hình | |
| 2 | xem bên dưới | Auth, RBAC, KYC, audit, file, thông báo, job, realtime | |
| 3 | xem bên dưới | Schema Prisma, ràng buộc, seed | |
| 4A | xem bên dưới | Danh mục, RFQ, báo giá, Deal Room, đơn, mẫu, khiếu nại | |
| 4B | xem bên dưới | Sổ cái, ví, rút tiền, đối soát | ⚠️ |
| 4C | xem bên dưới | Lô, tham gia, 7 bước, phân hàng, hoàn 45 ngày + 3% | ⚠️ |
| 4D | xem bên dưới | Bán giùm, POS, kho, điều phối, QC, thực địa, CRM, báo cáo | |
| 5 | xem bên dưới | Hợp đồng điện tử/chữ ký số, thanh toán thủ công (ảnh minh chứng), SMS, email, HĐĐT, dịch; eKYC và vận chuyển làm thủ công | 🔌 ⚠️ |
| 6A | xem bên dưới | Nền FE, design system, trang công khai, auth UI | |
| 6B | xem bên dưới | Trang cho 7 vai trò, admin | |
| 7 | xem bên dưới | Bảo mật, tuân thủ | ⚠️ |
| 8 | xem bên dưới | Unit, integration, E2E, tải, UAT | |
| 9 | xem bên dưới | Deploy, backup, giám sát, runbook | |
| 10–11 | xem bên dưới | Dữ liệu thật, nội dung, pilot, ra mắt | |

## Thứ tự làm đề xuất (1 người + Claude Code)

1. **Phase 0** (song song Phase 1; các task 🔒 chờ có quyết định).
2. **Phase 1 → 2 → 3**: nền tảng, auth/phân quyền, schema.
3. **Phase 4A + 6A + 6B (phần buyer/supplier)**: Tìm nguồn chạy trọn vòng với dữ liệu thật, thanh toán dùng luồng ảnh minh chứng, ký hợp đồng tạm làm bằng bước thủ công.
4. **Phase 4B + 5 (thanh toán thủ công bằng ảnh minh chứng, hợp đồng điện tử)**: hoàn thiện quy trình duyệt tiền, chi tiền và ký hợp đồng thật.
5. **Phase 4C + 6B (participant)**: Mua hộ.
6. **Phase 4D + 6B (retailer, inspector, sales, admin)**: Bán giùm, nội bộ.
7. **Phase 5 còn lại** (SMS, email, HĐĐT, dịch; eKYC và vận chuyển làm thủ công).
8. **Phase 7, 8, 9** làm xen suốt quá trình, siết lại trước ra mắt.
9. **Phase 10 → 11**: dữ liệu thật, pilot, ra mắt.

## Cổng chuyển giai đoạn (không qua cổng thì không làm tiếp)

- [ ] **Gate A** (sau Phase 3): schema được review, `docs/erd.md` có, migration chạy sạch từ đầu.
- [ ] **Gate B** (sau 4A): Tìm nguồn chạy được E2E với dữ liệu thật trong staging.
- [ ] **Gate C** (trước khi bật tiền thật): D1, D3, D9 đã chốt; sổ cái có test cân bằng; đối soát sao kê thủ công chạy được.
- [ ] **Gate D** (trước pilot): pentest nội bộ xong, backup + thử khôi phục xong, runbook xong.
- [ ] **Gate E** (trước ra mắt): luật sư xác nhận, giao dịch thử tiền thật khớp 100%.

## Theo dõi tiến độ (cập nhật khi xong)

| Phase | Xong / Tổng | Ghi chú |
|---|---|---|
| 0 | 1 / 13 | |
| 1 | 0 / 15 | |
| 2 | 0 / 23 | |
| 3 | 0 / 12 | |
| 4A | 0 / 22 | |
| 4B | 0 / 6 | |
| 4C | 0 / 10 | |
| 4D | 0 / 15 | |
| 5 | 0 / 23 | |
| 6A | 0 / 18 | |
| 6B | 0 / 43 | |
| 7 | 0 / 10 | |
| 8 | 0 / 11 | |
| 9 | 0 / 13 | |
| 10–11 | 0 / 16 | |

## Ánh xạ màn hình demo → module → trang

| Màn hình demo (`app.js`) | Module backend | Task FE |
|---|---|---|
| `market`, `product`, `supplierStore` | 4A Danh mục | F13–F14 |
| `rfqs`, `rfq`, `compare` | 4A RFQ/báo giá | F20–F21 |
| `orders`, `deal` | 4A Deal Room/đơn | F22–F27 |
| `claims` | 4A Khiếu nại | F28 |
| `campaigns`, `campaign`, `my-container` | 4C Mua hộ | F30–F34 |
| `settlements`, `intelligence` | 4B/4C Đối soát, sức mua | F37, F42 |
| `retail-catalog`, `retail`, `retail-product` | 4D Bán giùm | F38–F39 |
| `pos` | 4D Ghi nhận bán | F40 |
| `allocation`, `inventory` | 4D Kho/điều phối | F41 |
| `inspection` | 4D Thực địa | F48 |
| `supplier`, `supplier-accounts` | 4A NCC | F43–F46, F51 |
| `network` | 4D CRM | F47 |
| `funding` | 4D Hỗ trợ vốn (D10) | F29 |
| `showroom` | 4D Showroom | F17 |
| `messages`, `notifications`, `reports` | 4D Chung | F19, F46, F56 |
| `settings` (Thiết lập demo) | **Bỏ**, thay bằng cấu hình admin | F55 |

## Nếu cần rút ngắn

Giữ nguyên mọi mục ⚠️ (tiền, hợp đồng, bảo mật, pháp lý). Có thể dời sang backlog: đa ngôn ngữ (F9), dark mode (F11), dự báo (P4.48), hỗ trợ vốn (P4.50), showroom (P4.51), dịch AI (P5.22).

## Backlog sau ra mắt

- Tích hợp thanh toán tự động: cổng/VA/webhook, payout API, nhận diện ảnh minh chứng (OCR) thay duyệt tay.
- Tích hợp eKYC tự động (OCR CCCD + so khớp khuôn mặt) thay duyệt tay.
- Tích hợp API hãng vận chuyển (tạo vận đơn, tracking tự động).
- Ứng dụng di động native hoặc nâng cấp PWA (POS, kiểm tra thực địa, ký hợp đồng).
- Kết nối kênh bán (Shopee, TikTok Shop, POS ngoài) tự đồng bộ số bán.
- Tìm nguồn bằng ảnh, gợi ý nhà cung cấp tự động.
- Bảo hiểm hàng hóa, hải quan/logistics quốc tế nâng cao.
- Đánh giá, xếp hạng nhà cung cấp/đối tác theo lịch sử giao dịch.
- Tích hợp ngân hàng cho hỗ trợ vốn (nếu D10 giữ).
- BI nâng cao, dự báo nhu cầu bằng dữ liệu bán thật.

---


# Phase 0 – Quyết định nghiệp vụ và pháp lý

Mục tiêu: chốt những điểm quyết định schema, luồng tiền, hợp đồng. **Claude Code không tự chọn.** Mỗi quyết định ghi vào `docs/decisions.md` theo mẫu:

```
## D<n>. <Tên>
- Ngày chốt: 
- Người chốt: 
- Lựa chọn: 
- Lý do: 
- Ảnh hưởng tới task: 
- Trạng thái: Đã chốt / Tạm / Chưa chốt
```

Cho mỗi D bên dưới: **Câu hỏi cần sếp/luật sư trả lời** → **Lựa chọn khả dĩ** → **Task bị chặn**.

---

## [ ] D1. Vai trò của CVC trong giao dịch ⚠️
- Câu hỏi: CVC chỉ kết nối (khách ↔ nhà cung cấp trực tiếp), hay CVC là bên thu/giữ/chi tiền? Mô tả mới nhất của chủ dự án: CVC hỗ trợ tìm nguồn, khảo sát, giới thiệu, **không mua bán thay khách**.
- Lựa chọn: (a) CVC không chạm tiền: tiền đi khách → nhà cung cấp, CVC chỉ thu phí dịch vụ; (b) CVC nhận tiền vào tài khoản ngân hàng của CVC (hoặc bên được chỉ định), giữ theo sổ cái và giải ngân thủ công khi đủ điều kiện (rủi ro pháp lý cao, cần xác nhận ở D9).
- Chặn: P4.19, P4.20, P4.23–P4.28, P5.9–P5.16, thiết kế ví/sổ cái.
- Ghi chú: demo đang theo kiểu (c) (khách trả CVC → CVC giữ → chuyển NCC). Không port nguyên.

## [ ] D2. Bên ký hợp đồng trong Tìm nguồn ⚠️
- Câu hỏi: hợp đồng ký giữa ai? CVC là bên thứ ba chứng kiến, hay một bên ký?
- Lựa chọn: (a) khách ↔ NCC, CVC không ký; (b) CVC ký như bên trung gian/đại diện; (c) ba bên.
- Chặn: P5.1–P5.8 (chứng thư số công ty), mẫu hợp đồng C5.

## [ ] D3. Luồng tiền ⚠️
- **Đã chốt cách vận hành (D13):** thanh toán và chi tiền làm **thủ công kiểu P2P**: người dùng chuyển khoản ngân hàng, **tải ảnh minh chứng**, admin tài chính đối chiếu sao kê và duyệt. Không tích hợp cổng thanh toán, không webhook ở bản này.
- Còn phải chốt: tài khoản ngân hàng nhận tiền là của ai (CVC hay bên được chỉ định theo D1); thời hạn duyệt (SLA); ngưỡng cần duyệt hai lớp; quy trình hoàn tiền/chi NCC thủ công; trách nhiệm khi duyệt nhầm hoặc chuyển nhầm; pháp lý khi CVC nhận tiền hộ (D9).
- Chặn: P4.19, P4.20, P4.23–P4.28, P5.9–P5.16.

## [ ] D4. Công thức kinh tế theo từng lô/sản phẩm
- Câu hỏi: tỷ lệ lợi nhuận và tỷ lệ chia **thỏa thuận theo từng sản phẩm/lô**, không cố định. Chốt tập tham số và công thức.
- Cần chốt: giá vốn (đã gồm gì), chi phí logistics, kho, khác; hoa hồng/khoản hưởng của bên mua hộ; khoản hưởng của bên bán giùm; phần của CVC; làm tròn; áp dụng VND hay CNY.
- Gợi ý schema tham số trên `Campaign`/`CampaignLine`: `costPrice`, `retailPrice`, `participantShareRate`, `retailerShareRate`, `cvcFeeRate`, `logisticsCost`, `storageCost`, `otherCost`, `depositRate` (demo có `deposit: .30`).
- Chặn: P4.30, F52.
- Demo hiện gán cứng 20% / 10% / 10% → **bỏ**.

## [ ] D5. Quy tắc hoàn 45 ngày + 3% ⚠️
- Câu hỏi: "hàng đủ điều kiện" là gì (chưa bán? còn nguyên? không hỏng?); hoàn toàn bộ hay một phần; 3% chỉ tính trên **giá trị hàng được hoàn** (đã chốt trong mô tả); nguồn tiền chi 3% từ đâu; điều kiện/quy trình theo từng chương trình hay chung; mốc 45 ngày tính từ ngày nào (nhập kho? nhận hàng? chốt đợt?).
- Chặn: P4.36, F36.

## [ ] D6. Tiền tệ và tỷ giá
- Câu hỏi: hệ thống dùng VND, CNY hay cả hai? Tỷ giá lấy từ nguồn nào, chốt khi nào (lúc đặt cọc? lúc thanh toán?).
- Ghi chú: demo hiển thị giá vốn/hỗ trợ vốn bằng CNY.
- Chặn: schema tiền (cột `currency`), P5.14.

## [ ] D7. Thống nhất quy trình đơn Tìm nguồn
- Hiện có 2 bản: `orderSteps` (10 bước: Thương lượng, Mẫu thử, Hợp đồng, Đặt cọc, Sản xuất, QC, Thanh toán đuôi, Vận chuyển, Nhận hàng, Hoàn tất) và `stages` (8 bước: Trao đổi & chốt hàng, Duyệt mẫu, Hợp đồng, Đặt cọc, Chờ hàng hoàn tất, Thanh toán còn lại, Nhận hàng, Hoàn tất).
- **Đề xuất mặc định** (nếu sếp không có ý kiến khác): lưu **10 trạng thái nội bộ** (chính xác để vận hành, có QC riêng), hiển thị cho khách **8 giai đoạn** bằng cách gộp `Sản xuất + QC` thành "Chờ hàng hoàn tất" và `Vận chuyển` đi cùng giai đoạn trước nhận hàng.
- Chặn: P4.16, F23.

## [ ] D8. Chính sách khiếu nại/tranh chấp
- Câu hỏi: thời hạn khiếu nại; các phương án (hoàn tiền, đổi hàng, trả hàng, bù tiền – demo có `moveTopup`/`confirmTopup`); ai quyết định; CVC "hỗ trợ trao đổi và đối chiếu hợp đồng" cụ thể là làm gì; chi phí trả hàng ai chịu.
- Chặn: P4.22, F28.

## [ ] D9. Pháp lý ⚠️
- Việc cần làm (với luật sư/kế toán): (1) mô hình Mua hộ (góp tiền, chia lợi nhuận, hoàn + 3%) có bị xem là huy động vốn/đầu tư tài chính không; (2) ngành nghề đăng ký kinh doanh có khớp không; (3) thông báo/đăng ký website hoặc sàn thương mại điện tử với Bộ Công Thương; (4) nghĩa vụ bảo vệ dữ liệu cá nhân (thu CCCD, tài khoản ngân hàng); (5) hợp đồng thương mại điện tử và giá trị pháp lý chữ ký số với bên nước ngoài; (6) thuế và hóa đơn cho phí dịch vụ.
- Đầu ra: văn bản xác nhận; nội dung điều khoản, chính sách, cảnh báo rủi ro.
- Chặn: Gate C, Gate E, F15–F16, C4–C5.

## [ ] D10. Hỗ trợ tiếp cận vốn (`funding`)
- Câu hỏi: giữ hay bỏ? Nếu giữ: đối tác ngân hàng/tổ chức nào; CVC chỉ chuyển hồ sơ hay có thẩm định. Demo ghi rõ CVC **không phải tổ chức cấp tín dụng**.
- Chặn: P4.50, F29.

## [ ] D11. Danh sách bên thứ 3 chọn dùng
- Chốt từng mục còn tích hợp: hợp đồng điện tử/chữ ký số (Viettel vContract/MySign?), SMS/OTP/ZNS, email, hóa đơn điện tử, dịch, hosting, lưu file.
- **Không còn tích hợp** (đã chốt làm thủ công, xem D13): cổng thanh toán, eKYC tự động, API vận chuyển.
- Cho mỗi mục ghi: nhà cung cấp, gói, giá, người liên hệ, trạng thái hồ sơ.
- Chặn: các task tích hợp còn lại ở Phase 5.

## [ ] D12. Phạm vi nội dung thật
- Câu hỏi: ai cung cấp danh mục sản phẩm thật, ảnh có bản quyền, danh sách nhà cung cấp thật, banner đối tác thật, nội dung trang chủ/FAQ/điều khoản.
- Chặn: C1–C8, F13–F18.

## [x] D13. Vận hành thủ công và Docker (ĐÃ CHỐT)
- Thanh toán và chi tiền: **thủ công kiểu P2P** (chuyển khoản + ảnh minh chứng + admin duyệt). Không cổng thanh toán, không webhook ngân hàng.
- eKYC: **duyệt tay** bằng ảnh CCCD mặt trước/sau + ảnh chân dung cầm CCCD. Không tích hợp eKYC.
- Vận chuyển: NCC/CVC/khách **tự đặt hãng ngoài**, hệ thống chỉ lưu hãng, mã vận đơn, link tra cứu và **mốc nhập tay**. Không tích hợp API hãng.
- Hạ tầng: **toàn bộ chạy bằng Docker** (dev + prod), build image một lần và nén (`docker save | gzip`) hoặc đẩy registry để deploy dễ.
- Tích hợp tự động đưa vào Backlog, có thể cắm vào sau nhờ lớp adapter.
- Ảnh hưởng: P1.3, P1.11–P1.15, P2.14, P4.17, P4.19, P4.20, P4.26, P4.27, P5.9–P5.17, P5.21, F26, F27, S5, T3, T6, O1–O3, O13.

---

## DoD Phase 0
- [ ] `docs/decisions.md` có đủ D1–D13, mỗi mục có trạng thái.
- [ ] Các mục ⚠️ (D1, D2, D3, D5, D9) được sếp duyệt; D9 có xác nhận của luật sư.
- [ ] Danh sách task 🔒 trong các file phase đã được mở khóa hoặc ghi rõ còn chờ.

---


# Phase 1 – Nền tảng dự án, hạ tầng, CI/CD

Stack mặc định: pnpm monorepo · NestJS + Prisma + MySQL · React + Vite + TS · Redis + BullMQ · Socket.IO · SeaweedFS/S3 · Docker Compose · Nginx.

## [x] P1.1 Khởi tạo monorepo
- Việc làm:
  - Tạo `pnpm-workspace.yaml`, `package.json` gốc, thư mục `apps/api`, `apps/web`, `packages/shared`, `infra`, `docs`, `legacy/cvc-demo`.
  - Chép bản demo vào `legacy/cvc-demo/` (read-only; thêm `README` ghi rõ chỉ để tham chiếu).
  - Khởi tạo NestJS (`apps/api`), Vite React TS (`apps/web`), package `@cvc/shared`.
  - Cấu hình `tsconfig.base.json`, path alias `@cvc/shared`.
- DoD: `pnpm install` thành công; `pnpm --filter api build` và `pnpm --filter web build` chạy được.

## [ ] P1.2 Chất lượng code
- Việc làm: ESLint (typescript-eslint, import order), Prettier, EditorConfig, husky + lint-staged (lint/format khi commit), commitlint (Conventional Commits có task ID).
- DoD: commit sai format bị chặn; `pnpm lint` và `pnpm typecheck` chạy ở gốc cho cả hai app.

## [ ] P1.3 Docker cho tất cả (môi trường dev)
- Nguyên tắc: **mọi thứ chạy trong Docker**. Máy dev chỉ cần Docker + Git + editor; không cài MySQL/Redis/Node trực tiếp trên host.
- Việc làm: `infra/docker-compose.dev.yml` gồm `mysql` (8, volume, healthcheck), `redis`, `seaweedfs` + `seaweedfs-init` (tạo bucket), `mailpit`, `clamav` (tùy chọn), `api` (Dockerfile target `dev`, bind mount source, hot reload `nest start --watch`), `worker` (cùng image api, chạy queue), `web` (target `dev`, Vite HMR), `adminer` (xem DB, chỉ dev). Dùng `depends_on: condition: service_healthy`; `.dockerignore` cho từng app; volume named cho `node_modules`/pnpm store để nhanh; `Makefile` hoặc script `pnpm docker:*` (`up`, `down`, `logs`, `shell`, `reset-db`).
- Lệnh chuẩn: `docker compose -f infra/docker-compose.dev.yml up -d`; `... exec api pnpm test`; `... run --rm api pnpm prisma migrate dev`.
- DoD: máy sạch chỉ có Docker → clone repo → một lệnh lên đủ dịch vụ trong vài phút; sửa code hot reload; lint/test chạy trong container.

## [ ] P1.4 Cấu hình và biến môi trường
- Việc làm: dùng `@nestjs/config` + Zod/Joi validate env khi khởi động (thiếu biến → dừng ngay, in tên biến thiếu); `.env.example` cho api và web, ghi chú từng biến; tách `development` / `test` / `production`.
- Danh sách biến tối thiểu: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `S3_*`, `SMTP_*`/`EMAIL_*`, `APP_URL`, `API_URL`, `WEBHOOK_SECRET_*`, key từng tích hợp (để trống khi chưa có), `ENCRYPTION_KEY` (mã hóa dữ liệu nhạy cảm).
- DoD: chạy thiếu biến báo lỗi rõ; không có secret trong git (`.gitignore` kiểm tra).

## [ ] P1.5 Prisma và migration
- Việc làm: cài Prisma, `schema.prisma` rỗng có datasource MySQL, quy ước đặt tên (bảng số nhiều snake_case qua `@@map`, cột camelCase trong code), script `prisma:migrate`, `prisma:deploy`, `prisma:seed`, `prisma:reset` (chỉ dev), seed khung (chưa có dữ liệu mẫu đầy đủ, xong ở P3.12).
- Quy tắc: migration chỉ thêm, không sửa cái đã chạy.
- DoD: migrate + seed chạy từ DB trống; `prisma:reset` bị chặn nếu `NODE_ENV=production`.

## [ ] P1.6 Logging và xử lý lỗi
- Việc làm: pino (JSON log), request-id (header `x-request-id`), exception filter trả lỗi chuẩn `{ code, message, details?, requestId }`; map lỗi Prisma (unique, foreign key) thành mã lỗi rõ; che dữ liệu nhạy cảm (token, mật khẩu, CCCD, số tài khoản).
- DoD: lỗi 4xx/5xx đều đúng format; log không chứa dữ liệu nhạy cảm (test).

## [ ] P1.7 OpenAPI và client
- Việc làm: Swagger tự sinh từ decorator; xuất `openapi.json`; sinh client TypeScript cho web (openapi-typescript hoặc orval); script `pnpm gen:api`.
- DoD: web import client type-safe; CI kiểm tra `openapi.json` không lệch với code.

## [ ] P1.8 CI (GitHub Actions)
- Việc làm: workflow `ci.yml`: cài đặt cache pnpm → lint → typecheck → unit test → integration test (service MySQL/Redis) → build; chạy trên PR; bắt buộc xanh mới merge; workflow riêng cho E2E (chạy thủ công/hằng đêm).
- DoD: PR mẫu chạy đủ bước; nhánh `main` được bảo vệ.

## [ ] P1.9 Môi trường
- Việc làm: tách `dev`, `staging`, `production` (domain, DB, bucket, key riêng); staging dùng sandbox của bên thứ 3; production dùng khóa thật; quản lý secret (GitHub Secrets/Vault/`.env` chỉ trên server, quyền 600).
- DoD: tài liệu `docs/environments.md` liệt kê từng môi trường, domain, nơi đặt secret.

## [ ] P1.10 Tài liệu nền
- Việc làm: viết `docs/architecture.md` (sơ đồ module, luồng dữ liệu chính, quy ước đặt tên, cấu trúc thư mục), `docs/decisions.md` (khung rỗng từ Phase 0), `docs/erd.md` (khung).
- DoD: người mới đọc 3 file này hiểu cách chạy và cấu trúc.

## [ ] P1.11 Dockerfile production (api, worker, web)
- `apps/api/Dockerfile` multi-stage: `base` (node alpine, **pin phiên bản**) → `deps` (pnpm fetch + `install --frozen-lockfile`, cache mount) → `build` (tsc, `prisma generate`) → `prod` (chỉ prod deps, copy `dist` + `prisma`, **user non-root**, `HEALTHCHECK`, `CMD node dist/main.js`).
- `worker` dùng **chung image api**, chỉ khác command (`node dist/worker.js`).
- `apps/web/Dockerfile`: stage build (`vite build`) → runtime `nginx:alpine` phục vụ file tĩnh, SPA fallback, gzip/brotli, cache header, security header.
- **Một image chạy mọi môi trường**: cấu hình runtime của web đọc từ `config.js` sinh lúc container khởi động (không build lại cho staging/production); api đọc env.
- Mục tiêu: image api ≲ 300 MB, web ≲ 50 MB; không chứa `.env`, test, devDependencies.
- DoD: `docker build` lặp lại được; container chạy non-root; quét trivy không lỗ hổng nghiêm trọng; cùng image chạy được với env khác nhau.

## [ ] P1.12 Docker Compose production
- `infra/docker-compose.prod.yml`: `proxy` (Nginx/Caddy/Traefik: TLS, `/` → web, `/api` + `/socket.io` → api, giới hạn dung lượng upload), `web`, `api`, `worker`, `migrate` (one-off), `mysql`, `redis`, `seaweedfs`, `clamav`.
- Mạng nội bộ riêng; **chỉ `proxy` publish 80/443**; mysql/redis/seaweedfs **không publish port**; `restart: unless-stopped`; `env_file`/secrets; named volumes (`mysql-data`, `seaweed-data`, `redis-data`, `certs`); `healthcheck` mỗi service; giới hạn log (`json-file` max-size/max-file); giới hạn CPU/RAM; `image: ${REGISTRY}/cvc-api:${IMAGE_TAG}`, **không dùng `build:`** trong prod.
- DoD: `docker compose -f docker-compose.prod.yml config` hợp lệ; dựng lại toàn hệ thống trên máy trống chỉ bằng compose + `.env`.

## [ ] P1.13 Build, nén và phân phối image
- Build: `infra/scripts/build-images.sh <tag>` build `cvc-api`, `cvc-web` (tag theo git SHA + semver; `latest` chỉ cho staging).
- Phân phối hai cách: (1) **registry riêng** (GHCR/Docker Hub private): `docker push` rồi `docker compose pull`; (2) **nén thành file mang lên server không cần registry**: `docker save cvc-api:TAG cvc-web:TAG | gzip > cvc-images-TAG.tar.gz` → `scp/rsync` → `gunzip -c ... | docker load`. Viết `export-images.sh`, `import-images.sh` kèm **SHA-256** kiểm tra toàn vẹn.
- Giảm kích thước: alpine, multi-stage, `.dockerignore`, cache mount, dọn image cũ; ghi kích thước mỗi bản vào `docs/release-notes.md`.
- DoD: máy chủ trống chỉ cần Docker + 1 file `.tar.gz` + compose + `.env` là chạy được toàn hệ thống; SHA-256 khớp.

## [ ] P1.14 Migration và seed trong Docker
- Service `migrate` one-off dùng cùng image api: `docker compose run --rm migrate` chạy `prisma migrate deploy` (prod) / `migrate dev` (dev); chạy **trước** khi `up` api; api **không tự migrate** khi khởi động ở production.
- Seed production (admin, cấu hình, mẫu thông báo/hợp đồng) là lệnh one-off riêng; có cờ chặn `reset` và seed demo ở production.
- Backup trước migrate: `infra/scripts/db-backup.sh` (`docker compose exec mysql mysqldump ...`).
- DoD: `deploy.sh` chạy chuỗi "backup → nạp image mới → migrate → up → kiểm tra health" và **dừng, không up bản mới nếu migrate lỗi**.

## [ ] P1.15 CI build image
- GitHub Actions: build image api/web (cache layer), chạy test trong container, quét `trivy`, push registry khi merge `main`/tag, tạo artifact `cvc-images-TAG.tar.gz` + checksum cho release.
- Smoke test: `docker compose -f docker-compose.prod.yml up -d` (env test) → gọi `/health`, `/ready` và trang web trả 200.
- DoD: mỗi tag release tự sinh image + file nén + checksum; smoke test xanh.

---

## DoD Phase 1
- [ ] `docker compose -f infra/docker-compose.dev.yml up -d` chạy toàn bộ (dev); `docker-compose.prod.yml` chạy từ image build sẵn hoặc file nén.
- [ ] CI xanh trên PR.
- [ ] Swagger mở được ở `/docs`.
- [ ] Không có secret trong repo.

---


# Phase 2 – Backend nền tảng

Quy ước chung cho mọi API: prefix `/api/v1`; phân trang `?page=&pageSize=` trả `{ items, total, page, pageSize }`; sắp xếp `?sort=field:asc`; mặc định từ chối nếu thiếu quyền.

## 2.1 Xác thực và tài khoản

### [ ] P2.1 Đăng ký/đăng nhập email + mật khẩu
- Việc làm: bảng `User` (email unique, phone, passwordHash argon2id, status, emailVerifiedAt); API `POST /auth/register`, `POST /auth/login`, `POST /auth/verify-email`; email xác minh có token một lần, hết hạn; chính sách mật khẩu (độ dài, kiểm tra mật khẩu lộ phổ biến).
- DoD: đăng ký → email xác minh (mailpit) → đăng nhập; test mật khẩu sai, email trùng, token hết hạn.

### [ ] P2.2 Đăng nhập SĐT + OTP 🔌
- Việc làm: `POST /auth/otp/request`, `POST /auth/otp/verify`; OTP 6 số, hết hạn 5 phút, giới hạn số lần gửi và số lần thử; gửi qua adapter SMS/ZNS (mock ở dev).
- DoD: test hết hạn, sai OTP, vượt giới hạn; OTP không bao giờ vào log.

### [ ] P2.3 Quên/đặt lại/đổi mật khẩu
- Việc làm: `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/change-password`; thu hồi toàn bộ phiên khi đổi/đặt lại; phản hồi không tiết lộ email có tồn tại hay không; khóa tạm khi sai nhiều lần (đếm theo tài khoản + IP).
- DoD: test các nhánh; thông báo email khi đổi mật khẩu.

### [ ] P2.4 JWT và phiên
- Việc làm: access token ngắn (15 phút), refresh token xoay vòng lưu băm trong bảng `Session` (thiết bị, IP, UA, lastUsedAt); phát hiện dùng lại refresh token cũ → thu hồi cả chuỗi; `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`.
- DoD: test xoay vòng, tái sử dụng token cũ, thu hồi phiên.

### [ ] P2.5 2FA (TOTP)
- Việc làm: bật/tắt TOTP, mã dự phòng, xác thực khi đăng nhập; **bắt buộc** cho `admin`, `sales`, `inspector`; tùy chọn cho người dùng khác.
- DoD: admin không đăng nhập được nếu chưa bật 2FA; test mã sai/hết hạn.

### [ ] P2.6 Rate limit
- Việc làm: `@nestjs/throttler` + Redis; giới hạn riêng cho login, OTP, quên mật khẩu, tạo yêu cầu, gửi chat; phản hồi 429 có `Retry-After`.
- DoD: test vượt giới hạn.

## 2.2 Phân quyền

### [ ] P2.7 RBAC 7 vai trò
- Việc làm: enum `Role = buyer | participant | retailer | supplier | sales | inspector | admin` (từ `domain.js` `roles`); decorator `@Roles()`, guard; ma trận quyền ghi ở `docs/permissions.md` (vai trò × nhóm endpoint).
- DoD: ma trận có test tự động quét toàn bộ route, route nào thiếu khai báo quyền thì test fail.

### [ ] P2.8 Phân quyền theo bản ghi (chống IDOR)
- Việc làm: policy theo đối tượng (ví dụ `OrderPolicy.canView(user, order)`); mọi truy vấn lọc theo chủ sở hữu/tham gia; không trả 403 lộ sự tồn tại khi nên trả 404.
- DoD: bộ test thử truy cập chéo (user A đọc đơn của user B) cho mọi module.

### [ ] P2.9 Nhiều vai trò trên một tài khoản
- Việc làm: bảng `UserRole`; API `GET /me`, `POST /me/active-role`; token chứa vai trò đang dùng; chuyển vai trò không cần đăng nhập lại nhưng ghi audit.
- Không dùng bộ chuyển vai trò DEMO.
- DoD: người vừa mua hộ vừa bán giùm chuyển vai trò đúng, dữ liệu tách biệt.

### [ ] P2.10 Phân quyền admin chi tiết
- Việc làm: nhóm quyền admin: `admin_super`, `admin_ops`, `admin_finance`, `admin_support`; quyền rút/duyệt tiền chỉ cho `admin_finance`/`admin_super`; cấu hình hệ thống chỉ `admin_super`.
- DoD: test từng nhóm.

## 2.3 Hồ sơ và KYC

### [ ] P2.11 Hồ sơ
- Việc làm: `Organization`/`Profile` (cá nhân, hộ kinh doanh, doanh nghiệp: tên, mã số thuế, ĐKKD, địa chỉ, người đại diện); nhiều địa chỉ giao nhận; `BankAccount` (tên chủ TK phải khớp tên hồ sơ).
- API: `GET/PUT /me/profile`, `CRUD /me/addresses`, `CRUD /me/bank-accounts`.
- DoD: validate MST, SĐT, định dạng tài khoản; số tài khoản mã hóa khi lưu, hiển thị che (`****1234`).

### [ ] P2.12 Upload giấy tờ
- Việc làm: dùng file service (P2.17) với bucket riêng + mã hóa; loại `KycDocument` (CCCD mặt trước/sau, ĐKKD, giấy ủy quyền); chỉ chủ sở hữu và admin KYC xem.
- DoD: link tải có thời hạn ngắn; log truy cập.

### [ ] P2.13 Duyệt KYC thủ công
- Việc làm: trạng thái `pending | need_more | approved | rejected`, lý do bắt buộc khi từ chối/yêu cầu bổ sung; hàng đợi cho admin; thông báo cho người dùng; lịch sử duyệt.
- API admin: `GET /admin/kyc?status=`, `POST /admin/kyc/:id/approve|reject|request-more`.
- DoD: test chuyển trạng thái; audit log đủ.

### [ ] P2.14 Xác minh danh tính bằng ảnh, duyệt tay (không dùng eKYC tự động)
- Việc làm: người dùng tải **CCCD mặt trước, mặt sau và ảnh chân dung cầm CCCD** (giao diện có hướng dẫn chụp rõ, chụp trực tiếp bằng camera điện thoại hoặc chọn ảnh); admin KYC xem ảnh phóng to và **so khớp bằng mắt** theo checklist (ảnh rõ, thông tin khớp hồ sơ, khuôn mặt khớp, giấy tờ còn hạn, tên chủ tài khoản ngân hàng khớp); từ chối phải có lý do; yêu cầu bổ sung thì người dùng gửi lại; SLA duyệt hiển thị (cấu hình); phát hiện **ảnh/số CCCD trùng** giữa nhiều tài khoản (hash ảnh + băm có muối số CCCD) và cảnh báo; ghi log mỗi lần admin xem ảnh.
- Giữ sẵn interface `EkycProvider` (chưa implement) để sau này cắm eKYC tự động (Backlog).
- DoD: luồng nộp → duyệt/từ chối/bổ sung hoàn chỉnh; test cảnh báo CCCD trùng; ảnh chỉ người có quyền xem được.

### [ ] P2.15 Chặn thao tác khi chưa KYC
- Việc làm: guard `@RequireKyc(level)`; áp cho tham gia lô, đăng ký nhận bán, rút tiền, ký hợp đồng; thông báo rõ lý do ở frontend.
- DoD: test từng endpoint bị chặn đúng.

## 2.4 Dịch vụ dùng chung

### [ ] P2.16 Audit log bất biến
- Việc làm: bảng `AuditLog` (actor, role, action, entityType, entityId, before, after, ip, userAgent, requestId, createdAt); ghi tự động qua interceptor cho thao tác ghi quan trọng + ghi tay cho nghiệp vụ tiền; **không có API sửa/xóa**; (tùy chọn) hash chuỗi (mỗi dòng chứa hash dòng trước) để phát hiện can thiệp.
- API admin: `GET /admin/audit-logs` có lọc.
- DoD: mọi thao tác tiền, hợp đồng, phân quyền, tồn kho đều có log (test kiểm tra).

### [ ] P2.17 File service
- Việc làm: upload qua presigned URL (client → S3/SeaweedFS), `POST /files/presign` trả URL + `fileId`, `POST /files/:id/confirm`; kiểm tra MIME thật (magic bytes), giới hạn dung lượng theo loại; quét virus (ClamAV) bất đồng bộ, file chưa quét xong không cho tải; sinh thumbnail ảnh; quyền truy cập theo đối tượng sở hữu (`ownerType`, `ownerId`); tải xuống qua URL ký có hạn.
- DoD: test từ chối file sai loại/quá lớn, file độc hại; không truy cập được file của người khác.

### [ ] P2.18 Notification engine
- Việc làm: bảng `Notification`, `NotificationPreference`; sự kiện miền → `NotificationService.emit(event, data)` → render template (đa ngôn ngữ) → gửi kênh in-app/email/SMS/ZNS/push theo cấu hình; trạng thái đã đọc; API `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`.
- DoD: sự kiện mẫu đi đủ kênh ở dev (mailpit); người dùng tắt kênh thì không gửi (trừ thông báo bắt buộc: bảo mật, tiền).

### [ ] P2.19 Hàng đợi job
- Việc làm: BullMQ queues: `notifications`, `payments`, `reconcile`, `campaign`, `claims`, `files`; retry có backoff, dead-letter; bảng/trang theo dõi job (bull-board, chỉ admin); job định kỳ (cron) có khóa phân tán để chỉ chạy một bản.
- DoD: job lỗi được thử lại và vào dead-letter; test idempotency cho job nhận lại.

### [ ] P2.20 Realtime
- Việc làm: Socket.IO gateway, xác thực bằng JWT, phòng theo `dealRoomId` và `userId`; sự kiện: `message.new`, `order.status`, `notification.new`, `campaign.progress`; kiểm tra quyền khi join phòng; dùng Redis adapter nếu chạy nhiều tiến trình.
- DoD: user không join được phòng của người khác (test); mất kết nối tự nối lại ở FE.

### [ ] P2.21 Idempotency
- Việc làm: middleware nhận header `Idempotency-Key` cho các POST tạo giao dịch tiền/đơn/tham gia; lưu (key, hash request, response) trong Redis/DB TTL 24h; cùng key khác nội dung → 422.
- DoD: gọi lặp 10 lần chỉ tạo 1 bản ghi (test song song).

### [ ] P2.22 Cấu hình hệ thống
- Việc làm: `SystemSetting` (key, value JSON, version, updatedBy); API admin; có validate theo schema từng khóa; cache; ghi audit; mẫu email/SMS/hợp đồng quản lý qua đây hoặc bảng riêng.
- DoD: đổi cấu hình có hiệu lực không cần deploy; lịch sử thay đổi xem được.

### [ ] P2.23 Tìm kiếm
- Việc làm: bắt đầu bằng MySQL FULLTEXT (tên, SKU, thông số, danh mục) có bỏ dấu tiếng Việt (cột chuẩn hóa `searchText`, tương đương `searchText()` trong `sourcing-data.js`); đo hiệu năng, nâng lên Meilisearch/OpenSearch khi cần.
- DoD: tìm "ao mua" ra "Áo mưa..."; trả lời < 200 ms với dữ liệu thật.

---

## DoD Phase 2
- [ ] Đăng ký → xác minh → đăng nhập → KYC → vào đúng vai trò.
- [ ] Test phân quyền (ma trận + IDOR) xanh.
- [ ] Audit log, idempotency, rate limit hoạt động.
- [ ] File upload an toàn, thông báo đa kênh chạy ở dev.

---


# Phase 3 – Thiết kế database (Prisma/MySQL)

Nguyên tắc: mọi bảng có `id` (cuid/uuid), `createdAt`, `updatedAt`; bảng nghiệp vụ quan trọng có `deletedAt` (soft delete) hoặc cấm xóa; tiền dùng `Decimal(18,2)` (hoặc số nguyên đơn vị nhỏ nhất) kèm `currency`; enum cho trạng thái; index theo truy vấn thật; khóa ngoại đầy đủ.

## [ ] P3.1 Người dùng và tổ chức
Bảng: `User`, `UserRole`, `Organization`, `KycProfile`, `KycDocument`, `BankAccount`, `Address`, `Session`, `TotpSecret`, `OtpRequest`.
- Ràng buộc: `User.email` unique (nullable nếu đăng ký bằng SĐT), `User.phone` unique; `BankAccount` gắn `userId`/`organizationId`, số tài khoản lưu mã hóa + 4 số cuối.

## [ ] P3.2 Danh mục và nhà cung cấp
Bảng: `Category`, `Product` (sku dạng `CVC-001`, `name`, `spec`, `moq`, `leadTimeDays`, `priceRef` nội bộ), `ProductImage`, `ProductSpec`, `Supplier`, `SupplierAccount`, `SupplierProduct`, `PartnerBanner` (nhà cung cấp/vận chuyển, vị trí hiển thị, thời gian hiệu lực).
- Lưu ý: `priceRef` và `supplierId` **không** trả ra API công khai.

## [ ] P3.3 Tìm nguồn
Bảng: `SourcingRequest` (RFQ: `buyerId`, nội dung, ảnh, số lượng, `expiresAt`, status), `SourcingRequestAttachment`, `Quote` (`supplierId`, đơn giá, MOQ, lead time, hiệu lực đến), `QuoteSelection`, `Order`, `OrderStageLog`, `OrderEvent`, `Sample`, `SampleStop`, `Shipment` (hãng nhập tay, mã vận đơn, link tra cứu, ảnh phiếu), `ShipmentStop` (mốc nhập tay: thời điểm, mô tả, người nhập), `Claim`, `ClaimProposal`, `ClaimResolution`, `ReturnShipment`, `Refund`.
- `Order.status` theo bảng chuyển ở P4.16; `Order.stageIndex` hoặc enum 10 trạng thái (D7).

## [ ] P3.4 Deal Room
Bảng: `DealRoom` (1–1 với `Order` hoặc với `SourcingRequest` trước khi thành đơn), `DealRoomMember`, `Message` (`type`: text/system/offer), `MessageAttachment`, `Translation` (`messageId`, `lang`, `text`, `provider`), `Offer` (đề nghị giá: đơn giá, số lượng, điều kiện, trạng thái), `LockedTerms` (snapshot điều khoản khi chốt).
- `LockedTerms` bất biến sau khi khóa.

## [ ] P3.5 Hợp đồng
Bảng: `ContractTemplate` (loại: sourcing/participation/retail; version; nội dung có biến), `Contract` (`ownerType`, `ownerId`, `templateVersion`, `status`, `providerRef`, `signedFileId`, `fileHash`), `ContractParty`, `ContractSignature` (bên, thời điểm, phương thức ký, `providerRef`), `ContractVersion`.
- Sau `status=signed` cấm sửa nội dung.

## [ ] P3.6 Mua hộ
Bảng: `Campaign` (`name`, `productId`/nhiều dòng, `capacity`, `stage` (7 bước), `deadline`, `status`, tham số kinh tế theo D4: `costPrice`, `retailPrice`, `participantShareRate`, `retailerShareRate`, `cvcFeeRate`, `logisticsCost`, `storageCost`, `otherCost`, `depositRate`, `returnAfterDays` (mặc định 45), `returnBonusRate` (mặc định 3%)), `CampaignLine`, `CampaignStageLog`, `CampaignSurvey` (khảo sát sức mua), `CampaignRisk`, `Participation` (`userId`, `campaignId`, `amountPaid`, `unitsBought`, `status`, `joinedAt`), `ParticipationLine`, `GoodsRequest`, `ReturnRequest`.
- Ràng buộc: `unitsBought` là số nguyên; tổng `unitsBought` của lô ≤ `capacity` (kiểm tra bằng cập nhật nguyên tử, không chỉ ràng buộc ứng dụng).

## [ ] P3.7 Bán giùm
Bảng: `ResaleListing` (từ lô/hàng nhận bán: giá bán, khoản được hưởng, số lượng còn), `RetailerRegistration`, `Store` (điểm bán), `Allocation`, `AllocationLine`, `Transfer`, `TransferReceipt`.

## [ ] P3.8 Bán hàng và kho
Bảng: `Sale`, `SaleLine`, `SaleImport` (lô import CSV, để chống import trùng), `InventoryLot`, `InventoryMovement` (nhập/xuất/chuyển/điều chỉnh, **chỉ thêm**), `StockCount` (kiểm đếm), `Inspection`, `InspectionPhoto`, `QcReport`, `QcChecklistTemplate`.
- Tồn = tổng `InventoryMovement`; có bảng tổng hợp `InventoryBalance` cập nhật cùng transaction.

## [ ] P3.9 Tiền
Bảng: `Wallet`, `LedgerAccount`, `LedgerTransaction`, `LedgerEntry` (**bất biến**, mỗi `LedgerTransaction` có tổng nợ = tổng có), `ReceivingAccount` (tài khoản ngân hàng nhận tiền), `Payment`, `PaymentProof` (ảnh minh chứng + hash), `Payout`, `PayoutProof`, `BankStatementImport`, `BankStatementLine`, `Withdrawal`, `Settlement`, `ReconciliationRun`, `ReconciliationItem`, `Invoice`, `ExchangeRate`.
- Chặn ở tầng DB: không `UPDATE/DELETE` trên `LedgerEntry` (trigger hoặc quyền DB user chỉ INSERT/SELECT).

## [ ] P3.10 Khác
Bảng: `FundingApplication` (nếu giữ), `Notification`, `NotificationPreference`, `AuditLog`, `CrmContact`, `CrmActivity`, `ShowroomVisit`, `SystemSetting`, `Report`, `IdempotencyKey`.

## [ ] P3.11 Ràng buộc và hiệu năng
- Việc làm: rà từng bảng: khóa ngoại, unique, check (qty ≥ 0, amount ≥ 0), index theo truy vấn chính (danh sách theo user, theo trạng thái, theo lô), `FULLTEXT` cho tìm kiếm; quy ước `onDelete` (`Restrict` cho dữ liệu tiền).
- DoD: danh sách truy vấn chính + `EXPLAIN` không full scan.

## [ ] P3.12 Migration đầu và seed
- Việc làm: migration khởi tạo; seed dev/staging dựa trên `domain.js` `seed()` (30 sản phẩm, 18 NCC, 20 cửa hàng, 1–2 lô) và `reference-catalog.js`; seed production chỉ gồm: admin ban đầu, vai trò, cấu hình hệ thống, mẫu thông báo; script reset DB dev.
- DoD: migrate + seed từ DB trống chạy sạch; `docs/erd.md` có sơ đồ (mermaid) và chú thích quy tắc từng bảng.

---

## DoD Phase 3 (Gate A)
- [ ] Schema được review (tiền, ledger, ràng buộc).
- [ ] `docs/erd.md` hoàn chỉnh.
- [ ] Migration chạy sạch từ đầu; seed dev dùng được cho các phase sau.

---


# Phase 4A – Tìm nguồn hàng (P4.1 – P4.22)

Mỗi module: service + controller + DTO validate + test + Swagger. Logic port từ `vendor-flow.js`, `sourcing-data.js`, `buyer-flow.js`, `domain.js`.

## 4A.1 Danh mục và nhà cung cấp

### [ ] P4.1 CRUD sản phẩm
- API (vai trò): `POST/PUT/DELETE /admin/products` (admin, sales), `PATCH /admin/products/:id/visibility` (tương đương `toggleProduct`), `POST /admin/products/:id/images`.
- Việc làm: validate SKU unique, MOQ > 0, ảnh qua file service; thứ tự ảnh (gallery); thông số dạng cặp key-value.
- DoD: test CRUD + phân quyền; ẩn sản phẩm thì biến mất khỏi API công khai.

### [ ] P4.2 Danh mục công khai
- API: `GET /public/products?q=&category=&page=`, `GET /public/products/:sku`, `GET /public/categories`.
- Quy tắc: **không trả** giá mua và thông tin nhà cung cấp (`publicProducts` trong `sourcing-data.js`); tìm kiếm bỏ dấu; cache ngắn; chỉ sản phẩm `visible`.
- DoD: test khẳng định response không có trường `supplier*`, `priceRef`.

### [ ] P4.3 Hồ sơ tìm nguồn đã hỗ trợ (hiển thị công khai)
- Việc làm: khi một case tìm nguồn hoàn tất, sales có thể "publish" thành mục danh mục (tương đương `publishSourcingCase`, `portfolioProducts`): ẩn danh khách, ẩn NCC, giữ ảnh + thông số.
- API: `POST /admin/sourcing-cases/:id/publish`.
- DoD: mục công khai không chứa dữ liệu nhận dạng khách/NCC (test).

### [ ] P4.4 Cổng nhà cung cấp
- API: `GET/POST/PUT /supplier/products`, `PATCH /supplier/products/:id/visibility`.
- Việc làm: NCC chỉ thao tác sản phẩm của mình (`ownProducts`, `saveProduct`); sản phẩm NCC đăng cần admin duyệt trước khi hiện công khai (tùy chọn theo D12).
- DoD: NCC A không sửa được sản phẩm NCC B.

### [ ] P4.5 Tài khoản nhà cung cấp
- API admin: `POST /admin/suppliers`, `POST /admin/supplier-accounts` (`createAccount`), `PATCH /admin/supplier-accounts/:id/status` (`toggleAccount`).
- Việc làm: tạo NCC + tài khoản đăng nhập (gửi email mời đặt mật khẩu), khóa/mở, ghi audit; NCC bị khóa thì không đăng nhập và báo giá đang mở bị đình chỉ.
- DoD: test khóa/mở.

### [ ] P4.6 Banner đối tác
- API: `CRUD /admin/partner-banners` (loại `supplier`/`shipping`, ảnh, link, thứ tự, hiệu lực), `GET /public/partner-banners`.
- Tương đương `sponsoredSuppliers` + `service-banners.js`.
- DoD: banner hết hạn tự ẩn.

## 4A.2 RFQ và báo giá

### Máy trạng thái RFQ (`SourcingRequest`)
`open → quoted → selected → converted_to_order`; nhánh: `open|quoted → expired` (theo `expiresAt`), `* → cancelled` (khách hủy trước khi chọn). **Hết hạn thì không nhận báo giá và không chọn báo giá** (có test trong `vendor-tests.mjs`).

### [ ] P4.7 Khách gửi yêu cầu (`createRFQ`)
- API: `POST /sourcing-requests` (buyer), `GET /sourcing-requests`, `GET /sourcing-requests/:id`, `POST /sourcing-requests/:id/cancel`.
- Việc làm: nội dung, ảnh (nhiều), thông số, số lượng, giá mục tiêu (tùy chọn), thị trường bán, `expiresAt`; trạng thái ban đầu `open`; thông báo cho sales.
- DoD: validate số lượng > 0, ảnh hợp lệ; khách chỉ thấy yêu cầu của mình.

### [ ] P4.8 Sales tiếp nhận
- API: `GET /admin/sourcing-requests?status=&assignee=`, `POST /admin/sourcing-requests/:id/assign`, `POST /admin/sourcing-requests/:id/notes`.
- Việc làm: phân công sales, ghi chú nội bộ (khách không thấy), hạn xử lý (SLA), nhắc việc khi quá hạn.
- DoD: ghi chú nội bộ không lọt ra API của khách (test).

### [ ] P4.9 NCC báo giá (`postRequest`, `sendQuote`)
- API: `GET /supplier/requests` (yêu cầu phù hợp ngành/NCC được mời), `POST /supplier/requests/:id/quotes`, `PUT /supplier/quotes/:id`, `POST /supplier/quotes/:id/withdraw`.
- Việc làm: chỉ NCC được sales mời hoặc phù hợp mới thấy; báo giá gồm đơn giá, MOQ, lead time, hiệu lực, điều kiện giao; NCC không thấy báo giá của NCC khác; không báo giá khi RFQ hết hạn.
- DoD: test hết hạn, NCC không được mời không thấy.

### [ ] P4.10 Khách chọn báo giá (`selectQuote`)
- API: `GET /sourcing-requests/:id/quotes` (so sánh), `POST /sourcing-requests/:id/select-quote`.
- Việc làm: so sánh theo cột (đơn giá, MOQ, lead time, hiệu lực); báo giá hết hạn không chọn được; chọn xong tạo `Order` + `DealRoom` (hoặc mở phòng nếu đã có); thông báo cho NCC trúng và các NCC còn lại.
- DoD: chọn hai lần chỉ tạo một đơn (idempotent); test migration dữ liệu cũ giữ nguyên (như test "migration preserves existing buyer/container work").

### [ ] P4.11 Concierge
- Việc làm: sales tạo yêu cầu thay khách hoặc mở phòng giới thiệu NCC (`postConciergeRequest`, `openConciergeRoom`, `startSourcingExperience`); đọc `concierge-tests.mjs` để lấy hành vi chính xác.
- API: `POST /admin/concierge/requests`, `POST /admin/concierge/rooms`.
- DoD: port đủ các test trong `concierge-tests.mjs`.

## 4A.3 Deal Room

### [ ] P4.12 Phòng thương lượng
- API: `GET /deal-rooms/:id`, `GET /deal-rooms/:id/members`, `POST /deal-rooms/:id/members` (sales mời thêm).
- Việc làm: phòng riêng mỗi giao dịch; thành viên: khách, NCC trúng, sales CVC phụ trách (CVC không được xem giá nếu D1 quy định khác – theo quyết định); mọi truy cập kiểm tra thành viên.
- DoD: người ngoài phòng nhận 404 (test).

### [ ] P4.13 Chat realtime
- API: `GET /deal-rooms/:id/messages?cursor=`, `POST /deal-rooms/:id/messages`; socket `message.new`.
- Việc làm: văn bản, đính kèm (ảnh/video/file qua file service), tin hệ thống (đổi trạng thái), đã đọc, phân trang theo cursor, sanitize chống XSS, giới hạn tốc độ gửi.
- DoD: hai tài khoản chat realtime; tin có file hiển thị đúng quyền; test XSS payload bị vô hiệu.

### [ ] P4.14 Dịch tin nhắn 🔌
- API: `POST /messages/:id/translate?lang=`.
- Việc làm: adapter dịch (xem P5.22) + cache theo (messageId, lang); lưu bản gốc + bản dịch; hiển thị nhãn "dịch tự động"; giới hạn chi phí theo người dùng/ngày.
- DoD: bản dịch lưu và tái sử dụng; hết hạn mức thì báo lỗi rõ.

### [ ] P4.15 Đề nghị giá và chốt điều khoản (`offer`, `acceptPrice`, `acceptCurrentPrice`, `lockTerms`, `saveTerms`)
- API: `POST /deal-rooms/:id/offers`, `POST /offers/:id/accept|reject|counter`, `PUT /deal-rooms/:id/terms`, `POST /deal-rooms/:id/terms/lock`.
- Quy tắc: mỗi bên đề nghị/đối đề nghị; chỉ bên kia chấp nhận; chấp nhận → cập nhật giá hiện hành; **khóa điều khoản** cần cả hai bên xác nhận, sau khi khóa tạo `LockedTerms` (snapshot bất biến) và chuyển bước kế tiếp; sửa sau khóa phải mở lại bằng quy trình riêng có ghi nhận.
- DoD: test chuỗi đề nghị/đối đề nghị, không chấp nhận đề nghị cũ, snapshot không đổi.

## 4A.4 Đơn Tìm nguồn

### Máy trạng thái đơn (mặc định theo D7: 10 trạng thái nội bộ)
`negotiating → sampling → contract → deposit → production → qc → final_payment → shipping → received → completed`

| Từ → Sang | Ai bấm / sự kiện | Điều kiện (guard) | Tác dụng phụ |
|---|---|---|---|
| negotiating → sampling | hai bên khóa điều khoản (P4.15) | `LockedTerms` có; hoặc khách bỏ qua mẫu thì nhảy `contract` nếu D cho phép | tạo `Sample` nếu cần |
| sampling → contract | khách duyệt mẫu (`approveSample`) | mẫu `approved` | tạo `Contract` từ mẫu (P5.4) |
| contract → deposit | hợp đồng `signed` đủ các bên | chữ ký hợp lệ | tạo yêu cầu thanh toán cọc |
| deposit → production | admin duyệt minh chứng cọc | tổng đã thanh toán ≥ mức cọc | thông báo NCC bắt đầu sản xuất |
| production → qc | NCC báo xong (`reportProduction`, `ready`) | có ảnh/báo cáo | tạo `QcReport` chờ QC |
| qc → final_payment | QC đạt | `QcReport.passed` (không đạt → xử lý lỗi, ở lại `production`) | tạo yêu cầu thanh toán còn lại |
| final_payment → shipping | admin duyệt minh chứng thanh toán còn lại | đủ tiền | tạo `Shipment` |
| shipping → received | khách xác nhận nhận hàng (`confirmReceipt`) hoặc tự xác nhận sau N ngày | có tracking đến nơi | mở cửa sổ khiếu nại |
| received → completed | hết hạn khiếu nại / không có khiếu nại mở | không có `Claim` đang mở | chi trả NCC còn lại (nếu D1/D3 có) |

Nhánh: `* → cancelled` (trước `deposit`: tự do; sau `deposit`: theo điều khoản hợp đồng, có hoàn cọc/phạt – chờ D8). Mọi chuyển đi qua một hàm duy nhất; ghi `OrderEvent`.

### [ ] P4.16 Máy trạng thái đơn
- API: `GET /orders`, `GET /orders/:id`, `POST /orders/:id/transition` (body: `to`, `reason?`), tất cả kiểm tra bảng ở trên.
- Việc làm: cài bảng chuyển trong `packages/shared`; hàm `transition(order, to, actor)` trả lỗi `INVALID_TRANSITION`/`FORBIDDEN`; stepper hiển thị 8 giai đoạn gộp từ 10 trạng thái (D7).
- DoD: test ma trận (mọi cặp hợp lệ/không hợp lệ × vai trò); port `tests.mjs`.

### [ ] P4.17 Mẫu thử
- Trạng thái mẫu: `requested → uploaded → sent → in_transit → delivered → (revision_requested → uploaded…) | approved`.
- API: `POST /orders/:id/samples` (`requestSample`), `POST /samples/:id/upload` (NCC `uploadSample`), `POST /samples/:id/ship` (`sendSample`), `POST /samples/:id/stops` (`moveSample`: các điểm `sampleStops`, **nhập tay** bởi NCC/sales), `POST /samples/:id/receive` (`receiveSample`), `POST /samples/:id/revise` (`reviseSample`), `POST /samples/:id/approve` (`approveSample`).
- Việc làm: phí mẫu (nếu có) đi qua luồng thanh toán; theo dõi vận chuyển mẫu (NCC tự đặt hãng ngoài, nhập hãng + mã vận đơn + mốc bằng tay); giới hạn số vòng sửa (cấu hình).
- DoD: test chuyển trạng thái sai; mẫu đã duyệt không sửa lại.

### [ ] P4.18 Thông tin khách cho hợp đồng (`customerInfo`)
- Việc làm: thu thập/đối chiếu thông tin pháp lý của khách (tên, MST/CCCD, địa chỉ, người đại diện) từ hồ sơ KYC; khóa khi hợp đồng đã tạo.
- API: `GET/PUT /orders/:id/customer-info`.
- DoD: thiếu thông tin thì không tạo được hợp đồng.

### [ ] P4.19 Đặt cọc, thanh toán (ảnh minh chứng), sản xuất, vận chuyển nhập tay, nhận hàng 🔒 D3
**A. Thanh toán thủ công kiểu P2P**
- Trạng thái `Payment`: `awaiting_proof → proof_submitted → approved | partial | rejected | expired`.
- API người dùng: `POST /orders/:id/payments` (tạo yêu cầu: loại cọc/còn lại, số tiền từ `LockedTerms`, **mã tham chiếu duy nhất** làm nội dung chuyển khoản, tài khoản nhận từ `ReceivingAccount`, hạn nộp), `POST /payments/:id/proofs` (ảnh minh chứng + khai số tiền, thời điểm chuyển, ngân hàng gửi, mã giao dịch), `GET /payments/:id`.
- API admin tài chính: `GET /admin/payments?status=proof_submitted`, `POST /admin/payments/:id/approve` (số tiền thực nhận, ghi chú), `POST /admin/payments/:id/reject` (lý do, cho nộp lại), `POST /admin/payments/:id/request-more`.
- Quy tắc: **không tự chuyển bước khi chưa admin duyệt**; chỉ ghi sổ cái khi duyệt, idempotent; số tiền duyệt khác yêu cầu → `partial` và tạo yêu cầu bù phần thiếu; chống dùng lại ảnh (hash) và mã giao dịch trùng; quá hạn nộp → `expired`; thông báo admin khi có minh chứng mới, thông báo người dùng khi duyệt/từ chối.

**B. Sản xuất**: `POST /orders/:id/production-reports` (NCC, kèm ảnh/video), `POST /orders/:id/ready`.

**C. Vận chuyển tự đặt, tracking nhập tay**
- Hàng do NCC/CVC/khách **tự đặt hãng vận chuyển bên ngoài**; hệ thống không gọi API hãng.
- API: `POST /orders/:id/shipments` (hãng nhập tay, mã vận đơn, link tra cứu tùy chọn, ngày gửi, ngày dự kiến, ảnh phiếu gửi), `POST /shipments/:id/stops` (`moveGoods`: thêm mốc thủ công gồm thời điểm, mô tả, người nhập; có mốc gợi ý theo `shippingStops` để chọn nhanh), `PUT /shipments/:id`.
- Ai nhập: NCC (từ xưởng đến khi giao hãng), sales CVC (quốc tế, nhập kho, giao nội địa); job nhắc khi quá N ngày chưa cập nhật mốc.

**D. Nhận hàng**: `POST /orders/:id/confirm-receipt`.
- DoD: test thanh toán thiếu/thừa/trùng ảnh/hết hạn/duyệt hai lần; không chuyển bước khi chưa duyệt; khách xem được timeline vận chuyển nhập tay.

### [ ] P4.20 Chi trả nhà cung cấp thủ công 🔒 D1/D3 ⚠️
- Việc làm: theo luồng đã chốt: tạo `Payout` (người nhận, tài khoản đã xác minh, số tiền, lý do, tham chiếu đơn) → **duyệt** (hai lớp nếu vượt ngưỡng) → admin tài chính **chuyển khoản ngoài hệ thống** → bấm "đã chuyển" kèm **ảnh minh chứng chi** + mã giao dịch → NCC xác nhận đã nhận (hoặc tự xác nhận sau N ngày) → ghi sổ cái. Nếu D1 là "CVC không chạm tiền": chỉ ghi nhận xác nhận hai bên.
- API: `POST /admin/orders/:id/supplier-payouts`, `POST /admin/payouts/:id/approve|reject|mark-paid`, `POST /payouts/:id/confirm-received` (NCC).
- Quy tắc: tên chủ tài khoản phải khớp hồ sơ NCC đã xác minh; chống chi trùng (khóa theo reference); đổi tài khoản nhận tiền cần xác minh lại.
- DoD: payout không ghi sổ cái hai lần; sổ cái cân bằng; ảnh minh chứng chi lưu bất biến.

### [ ] P4.21 Tự động hóa tiến độ (`setAuto`, `pump`)
- Việc làm: chỉ cho môi trường test/staging (cờ `ENABLE_SIMULATION=true`); production trả 404.
- DoD: test bật/tắt theo môi trường.

### [ ] P4.22 Khiếu nại (`issue`, `proposeCase`, `chooseResolution`, `moveTopup`, `confirmTopup`, `sendReturn`, `receiveReturn`, `executeRefund`, `confirmRefund`, `resolveClaim`) 🔒 D8
- Trạng thái: `opened → proposed → resolution_chosen → (topup_pending → topup_confirmed) | (return_sent → return_received) → refund_executed → refund_confirmed → closed`; nhánh `rejected`, `withdrawn`.
- API: `POST /orders/:id/claims`, `POST /claims/:id/proposals` (sales/NCC đề xuất phương án), `POST /claims/:id/choose-resolution` (khách), `POST /claims/:id/topup` + `/confirm`, `POST /claims/:id/return/ship` + `/receive`, `POST /admin/claims/:id/execute-refund`, `POST /claims/:id/confirm-refund`, `POST /admin/claims/:id/resolve`.
- Việc làm: chứng cứ (ảnh/video) bắt buộc; thời hạn khiếu nại theo D8; CVC đối chiếu hợp đồng (xem được `LockedTerms` + hợp đồng đã ký); hoàn tiền đi qua luồng tiền (4B) và sổ cái.
- DoD: port toàn bộ `payment-cases-tests.mjs`; test mọi nhánh; hoàn tiền không vượt số đã thu.

---

## DoD Phase 4A (Gate B)
- [ ] Tìm nguồn chạy E2E ở staging: gửi yêu cầu → báo giá → chọn → Deal Room → chốt giá → mẫu → hợp đồng → cọc → sản xuất → QC → thanh toán đuôi → vận chuyển → nhận hàng → hoàn tất; và nhánh khiếu nại.
- [ ] Toàn bộ test demo liên quan (`tests`, `buyer`, `vendor`, `concierge`, `payment-cases`, `sourcing`) đã port và xanh.
- [ ] Không có dữ liệu giá mua/NCC lộ ở API công khai.

---


# Phase 4B – Tiền, ví, sổ cái, đối soát (P4.23 – P4.28) ⚠️

**Chỉ bật tiền thật sau Gate C.** Mọi thiết kế phụ thuộc D1, D3, D6.

## Nguyên tắc
1. **Sổ cái kép bất biến**: mỗi `LedgerTransaction` gồm nhiều `LedgerEntry` (debit/credit) có tổng nợ = tổng có; không có API/SQL sửa-xóa.
2. **Một nguồn sự thật**: số dư ví = tổng bút toán của `LedgerAccount`, không lưu số dư rời mà không đối chiếu (có thể cache `Wallet.balance` nhưng phải đối chiếu định kỳ).
3. **Mọi thao tác tiền trong một transaction DB**, có `Idempotency-Key`, có `referenceType/referenceId` trỏ về đơn/lô/rút tiền.
4. **Tiền vào chỉ được ghi sổ khi admin tài chính duyệt** ảnh minh chứng (đối chiếu sao kê ngân hàng); người dùng không tự xác nhận.
5. **Sai thì đảo**: tạo bút toán đảo, không sửa.

## Sơ đồ tài khoản sổ cái (đề xuất, điều chỉnh theo D1/D3)
| Tài khoản | Loại | Ý nghĩa |
|---|---|---|
| `bank_account:{id}` | Tài sản | Tiền trong tài khoản ngân hàng của CVC |
| `wallet:{userId}` | Nợ phải trả | Số dư người dùng (có thể rút) |
| `escrow:order:{orderId}` | Nợ phải trả | Tiền khách đặt cọc/thanh toán, chờ giải ngân |
| `escrow:campaign:{campaignId}:{participantId}` | Nợ phải trả | Tiền tham gia lô, chờ chốt đợt |
| `supplier_payable:{supplierId}` | Nợ phải trả | Phải trả nhà cung cấp |
| `refund_reserve` | Nợ phải trả | Tiền dự phòng hoàn |
| `cvc_fee_revenue` | Doanh thu | Phí dịch vụ CVC |
| `bank_fee_expense` | Chi phí | Phí ngân hàng |
| `bonus_expense` | Chi phí | Khoản cộng 3% hoàn sau 45 ngày (nguồn tiền theo D5) |

Ví dụ bút toán (nếu CVC có giữ tiền qua đối tác):
- Khách trả cọc đơn X: `Dr bank_account` / `Cr escrow:order:X`.
- Giải ngân cọc cho NCC: `Dr escrow:order:X` / `Cr supplier_payable:S`; sau đó payout: `Dr supplier_payable:S` / `Cr bank_account`.
- Tham gia lô: `Dr bank_account` / `Cr escrow:campaign:C:U` (đúng bằng giá trị số hàng nguyên mua được; phần dư vào `wallet:U` hoặc hoàn lại).
- Hoàn 45 ngày + 3%: `Dr escrow/reserve` (giá trị hàng) + `Dr bonus_expense` (3% × giá trị hàng hoàn) / `Cr wallet:U`.
- Phí ngân hàng: `Dr bank_fee_expense` / `Cr bank_account`.

Nếu D1 chọn "CVC không chạm tiền": sổ cái chỉ ghi nhận phí dịch vụ và trạng thái xác nhận, không có escrow ở CVC.

---

### [ ] P4.23 Sổ cái kép
- Việc làm: bảng `LedgerAccount`, `LedgerTransaction`, `LedgerEntry`; service `LedgerService.post(entries[], ref, idempotencyKey)` kiểm tra cân bằng, cùng currency, tài khoản tồn tại; ràng buộc DB (user DB chỉ INSERT/SELECT trên `LedgerEntry`); API đọc cho admin tài chính.
- DoD: test tổng nợ = tổng có mọi trường hợp; thử UPDATE/DELETE trực tiếp bị từ chối; test song song cùng key.

### [ ] P4.24 Ví người dùng (`wallet`)
- Việc làm: `Wallet` (khả dụng, tạm giữ); API `GET /me/wallet`, `GET /me/wallet/transactions`; chặn âm số dư (kiểm tra trong transaction); xuất sao kê PDF/Excel.
- DoD: test hai trừ tiền song song không làm âm ví.

### [ ] P4.25 Kiểm tra bảo toàn (`assertConservation`)
- Việc làm: port ý tưởng `assertConservation` trong `domain.js`: job chạy định kỳ và sau giao dịch quan trọng kiểm tra (tổng nợ = tổng có toàn hệ thống; số dư ví = tổng bút toán; tiền thu = tiền ở đối tác + đã chi); lệch → cảnh báo khẩn cho admin tài chính và khóa tạm thao tác rút tiền.
- DoD: test chủ động tạo lệch (trong DB test) và kiểm tra cảnh báo/khóa.

### [ ] P4.26 Rút tiền (`withdraw`) – duyệt và chi thủ công
- Trạng thái: `requested → approved → paid | rejected | cancelled` (chỉ `paid` khi có ảnh minh chứng chi).
- API: `POST /me/withdrawals` (cần KYC, tài khoản ngân hàng đã xác minh), `GET /me/withdrawals`, `POST /admin/withdrawals/:id/approve|reject`, `POST /admin/withdrawals/:id/mark-paid` (ảnh minh chứng chi + mã giao dịch).
- Quy tắc: hạn mức/ngày, tối thiểu; tạm giữ tiền khi yêu cầu (khả dụng → tạm giữ); duyệt hai lớp trên ngưỡng; chuyển khoản **thủ công ngoài hệ thống**; bị từ chối/hủy → hoàn về ví bằng bút toán đảo; người dùng xem được ảnh minh chứng chi.
- DoD: test hạn mức, từ chối, hủy, đánh dấu `paid` hai lần (idempotent).

### [ ] P4.27 Đối soát thủ công với sao kê ngân hàng (`reconcile`, `settle`)
- Việc làm: admin tài chính **tải sao kê ngân hàng** (CSV/Excel) lên (`BankStatementImport`, các dòng `BankStatementLine`); hệ thống **gợi ý khớp** từng dòng với `Payment`/`Payout`/`Withdrawal` theo số tiền + nội dung (mã tham chiếu) + ngày; admin xác nhận hoặc gán thủ công; phân loại: khớp, minh chứng đã duyệt nhưng **không có tiền về** (cảnh báo đỏ), tiền về chưa có minh chứng, sai số tiền, trùng, chuyển nhầm nội dung; `ReconciliationRun` + `ReconciliationItem`; xử lý từng dòng lệch (gán đơn, hoàn tiền thừa, đảo bút toán duyệt nhầm).
- Tần suất: nhắc hằng ngày, cho phép nhập theo kỳ.
- DoD: dữ liệu mẫu có đủ loại lệch và hệ thống phân loại đúng; báo cáo xuất được; duyệt nhầm xử lý bằng bút toán đảo.

### [ ] P4.28 Báo cáo dòng tiền, công nợ, sao kê
- Việc làm: báo cáo theo kỳ cho admin tài chính (thu, chi, phí, công nợ NCC, tiền đang giữ, doanh thu phí), sao kê theo người dùng; xuất Excel/PDF; dữ liệu lấy từ sổ cái.
- DoD: số liệu báo cáo khớp tổng sổ cái (test).

---

## DoD Phase 4B (một phần Gate C)
- [ ] Sổ cái cân bằng, không sửa/xóa được; kiểm tra bảo toàn chạy định kỳ.
- [ ] Ví không âm dưới tải song song.
- [ ] Rút tiền và đối soát sao kê chạy đủ các nhánh (duyệt, từ chối, hủy, lệch) ở staging.

---


# Phase 4C – Mua hộ (P4.29 – P4.38) ⚠️

Port từ `participant-flow.js` (`publicCampaigns`, `lot`, `estimatePurchase`, `quote`, `analysis`, `economics`, `join`, `sign`, `pay`, `advance`, `pump`, `reconcile`, `inventory`, `takeLines`, `splitLines`, `pickup`, `requestReturn`, `returnNext`, `contractText`) và `domain.js` (`join`, `advanceCampaign`, `requestGoods`, `settle`, `forecast`). Test tham chiếu: `participant-tests.mjs`, `tests.mjs`.

## Máy trạng thái lô (`Campaign`, 7 bước)
`registration → closing → production → qc → shipping → warehouse → distribution`
(Đăng ký → Chốt đợt → Sản xuất → QC → Vận chuyển → Nhập kho → Phân phối)

| Từ → Sang | Ai | Điều kiện |
|---|---|---|
| registration → closing | admin/sales hoặc hết hạn đăng ký | đạt ngưỡng tối thiểu (cấu hình) hoặc tới `deadline` |
| closing → production | admin | chốt danh sách người tham gia; **thiếu ngưỡng thì hủy lô và hoàn tiền tự động**; thanh toán đủ (cọc theo `depositRate`) |
| production → qc | admin/NCC | báo cáo sản xuất |
| qc → shipping | inspector/admin | QC đạt; không đạt thì xử lý lỗi |
| shipping → warehouse | admin | theo dõi vận chuyển, hải quan (nếu có) |
| warehouse → distribution | admin | nhập kho đủ; phân hàng cho từng người tham gia |

Nhánh: `* → cancelled` (admin, có lý do, có hoàn tiền theo quy tắc). Mọi chuyển qua một hàm duy nhất, có `CampaignStageLog` và thông báo cho người tham gia.

---

### [ ] P4.29 Đăng lô (`publicCampaigns`, `lot`)
- API admin/sales: `POST /admin/campaigns`, `PUT /admin/campaigns/:id`, `POST /admin/campaigns/:id/lines`, `POST /admin/campaigns/:id/publish`.
- Việc làm: lô có danh sách hàng (`CampaignLine`: sản phẩm, số lượng, giá vốn), tổng giá trị, khảo sát sức mua (`CampaignSurvey`), giá bán, đầu ra, lợi nhuận dự kiến, rủi ro (`CampaignRisk`), hạn đăng ký, `capacity`; chỉ hiện công khai sau `publish`; sửa số liệu sau khi có người tham gia phải có ghi nhận và thông báo.
- API công khai/người dùng: `GET /campaigns`, `GET /campaigns/:id` (có phân tích kinh tế, cảnh báo rủi ro).
- DoD: lô chưa publish không lộ ra; sửa giá sau khi có người tham gia bị chặn hoặc cần quy trình riêng.

### [ ] P4.30 Công thức kinh tế theo từng lô 🔒 D4
- Việc làm: cài `economics(campaign)` và `analysis(campaign)` (port) nhưng **tham số lấy từ `Campaign`**, không hằng số 20/10/10; hàm thuần, có test bảng giá trị; hiển thị breakdown (giá vốn, logistics, kho, chi phí khác, lợi nhuận dự kiến, phần người mua hộ, phần bán giùm, phần CVC); làm tròn theo quy tắc chốt ở D4; có chế độ xem trước cho admin khi nhập tham số.
- API: `POST /admin/campaigns/preview-economics`, `GET /campaigns/:id/economics`.
- DoD: bảng test công thức nhiều bộ tham số; thay đổi tham số theo lô cho kết quả khác nhau; không lời văn cam kết lợi nhuận (chỉ "dự kiến", có cảnh báo).

### [ ] P4.31 Tham gia lô (`join`, `parseAmount`, `estimatePurchase`, `quote`)
- API: `POST /campaigns/:id/quote` (nhập số tiền → trả số hàng nguyên mua được, phần dư, tổng thanh toán), `POST /campaigns/:id/participations` (Idempotency-Key bắt buộc).
- Quy tắc: mua **số lượng nguyên** tương ứng số tiền (không mua cả container); kiểm tra KYC; kiểm tra hạn mức còn lại và **trừ hạn mức bằng cập nhật nguyên tử** (`UPDATE campaigns SET remaining = remaining - :n WHERE id = :id AND remaining >= :n`); đóng đăng ký khi đầy; hạn mức tối thiểu/tối đa mỗi người (cấu hình).
- DoD: test hai người cùng mua phần hạn mức cuối chỉ một người thành công; test nhập số tiền không đủ 1 đơn vị; test idempotency.

### [ ] P4.32 Ký thỏa thuận và thanh toán (`sign`, `contractText`, `pay`) 🔌
- Việc làm: tạo hợp đồng tham gia từ mẫu (`contractText` → mẫu P5.4) điền số lượng, giá trị, điều kiện 45 ngày/3%; ký (P5.5); thanh toán bằng chuyển khoản + ảnh minh chứng, admin duyệt (P5.10–P5.12); trạng thái `Participation`: `pending_sign → pending_payment → paid → active | cancelled | expired`; hết hạn thanh toán thì nhả hạn mức.
- DoD: admin duyệt minh chứng xong mới `active`; quá hạn thì hạn mức được hoàn lại (job); test nhả hạn mức không bị trùng.

### [ ] P4.33 Chốt đợt
- Việc làm: job tại `deadline` hoặc khi admin bấm: đủ ngưỡng → `closing → production` và khóa danh sách; thiếu ngưỡng → hủy lô, hoàn tiền toàn bộ người đã thanh toán (bút toán đảo, thông báo); ghi báo cáo chốt đợt.
- API: `POST /admin/campaigns/:id/close`.
- DoD: test hủy lô hoàn đủ tiền từng người và sổ cái cân bằng.

### [ ] P4.34 Máy trạng thái 7 bước (`advanceCampaign`, `advance`, `pump`, `elapsed`)
- Việc làm: cài bảng chuyển ở trên; mỗi bước có người được phép và điều kiện; đính kèm ảnh/video/báo cáo tiến độ; thông báo cho người tham gia; `pump`/`elapsed` chỉ cho mô phỏng test.
- API: `POST /admin/campaigns/:id/advance` (body `to`, `reportFileIds?`, `note?`), `GET /campaigns/:id/timeline`.
- DoD: test ma trận chuyển hợp lệ/không hợp lệ.

### [ ] P4.35 Phân hàng cho người tham gia (`takeLines`, `splitLines`, `skuStock`, `inventory`, `pickup`, `requestGoods`)
- Việc làm: khi vào `warehouse → distribution`, hệ thống chia hàng theo `unitsBought` của từng người (xử lý hàng lẻ/làm tròn theo quy tắc chốt); mỗi người chọn **tự nhận hàng kinh doanh** (hẹn lịch/điểm nhận, ghi `pickup`) hoặc **đưa vào bán giùm** (tạo `ResaleListing`/`Allocation`, 4D); tồn kho cập nhật bằng `InventoryMovement`.
- API: `GET /me/participations/:id/goods`, `POST /me/participations/:id/pickup`, `POST /me/participations/:id/send-to-resale`.
- DoD: tổng hàng chia ra = tổng hàng nhập kho (test bảo toàn); người đã nhận không nhận lại.

### [ ] P4.36 Hoàn giá trị hàng + 3% sau 45 ngày 🔒 D5 ⚠️
- Việc làm: mốc 45 ngày theo D5; job hằng ngày tìm phần hàng đủ điều kiện; người dùng gửi yêu cầu (`requestReturn`) hoặc hệ thống đề xuất; xử lý `returnNext` từng bước: yêu cầu → kiểm hàng → duyệt → hoàn; **khoản cộng thêm 3% chỉ tính trên giá trị hàng được hoàn**; ghi bút toán: hoàn giá trị hàng + chi 3% (nguồn tiền theo D5); chi tiền hoàn bằng payout thủ công có ảnh minh chứng (P5.13); hàng hoàn về kho CVC (`InventoryMovement`).
- Trạng thái `ReturnRequest`: `eligible → requested → inspecting → approved → refunded | rejected`.
- API: `GET /me/participations/:id/return-eligibility`, `POST /me/participations/:id/returns`, `POST /admin/returns/:id/approve|reject`.
- DoD: bảng test nhiều tình huống (hoàn toàn bộ/một phần, chưa đủ 45 ngày, hàng đã bán); 3% tính đúng chỉ trên phần hoàn; sổ cái cân bằng; tham số 45 và 3% đọc từ `Campaign` (không hard-code).

### [ ] P4.37 Theo dõi và đối soát người tham gia (`participantOverview`, `reconcile`)
- Việc làm: tổng hợp cho từng người: hàng đã mua, hàng xuất cho điểm bán, hàng đã bán, tồn, tiền thu về, lợi nhuận tạm tính, tiền cần đối soát; đối soát với dữ liệu bán của 4D; xuất bản sao kê.
- API: `GET /me/participations`, `GET /me/participations/:id/overview`, `GET /me/participations/:id/settlement`.
- DoD: số liệu khớp với `Sale` và sổ cái (test).

### [ ] P4.38 Mô phỏng ngày bán (`simulateDay`)
- Việc làm: chỉ test/staging (`ENABLE_SIMULATION`); sinh dữ liệu bán giả để demo/nghiệm thu; production trả 404.
- DoD: test cờ môi trường.

---

## DoD Phase 4C
- [ ] Mua hộ chạy E2E ở staging: đăng lô → tham gia (có tranh chấp hạn mức cuối) → ký → thanh toán → chốt đợt → 7 bước → phân hàng → bán → hoàn 45 ngày + 3%.
- [ ] Công thức kinh tế đọc tham số theo lô, không còn hằng số cứng.
- [ ] Toàn bộ `participant-tests.mjs` đã port và xanh; sổ cái cân bằng ở mọi kịch bản.

---


# Phase 4D – Bán giùm và vận hành nội bộ (P4.39 – P4.53)

Port từ `domain.js` (`allocate`, `allocationNext`, `sale`, `transfer`, `receiveTransfer`, `settle`, `stock`, `stats`, `funding`, `forecast`), `app.js` (các màn `retail*`, `pos`, `allocation`, `inventory`, `inspection`, `network`, `intelligence`).

## 4D.1 Bán giùm

### [ ] P4.39 Danh sách hàng nhận bán (`retailListings`, `retailCatalog`)
- API: `GET /retail/listings?q=&category=`, `GET /retail/listings/:id`.
- Việc làm: hiển thị mặt hàng, **giá bán** và **khoản được hưởng** (theo tham số của lô, D4), số lượng còn, điều kiện hợp tác; chỉ người đã KYC thấy chi tiết kinh tế.
- DoD: khoản được hưởng tính đúng theo tham số lô (test).

### [ ] P4.40 Đăng ký nhận bán và thỏa thuận
- API: `POST /retail/registrations` (số lượng, điểm bán), `POST /retail/registrations/:id/sign`, `POST /retail/registrations/:id/deposit` (nếu có đặt cọc; dùng luồng minh chứng P5.11).
- Trạng thái: `registered → pending_sign → (pending_deposit) → active | rejected | cancelled`.
- Việc làm: kiểm tra số lượng còn (cập nhật nguyên tử giống P4.31); thỏa thuận hợp tác ký điện tử (P5.5, mẫu `retail` ở P5.4 — **demo chưa có hàm riêng, cần thêm mới**); admin duyệt đăng ký.
- DoD: test hết hạn mức, ký trước khi nhận hàng.

### [ ] P4.41 Điều phối hàng hóa (`allocate`, `allocationNext`, `transfer`, `receiveTransfer`, `requestGoods`)
- Việc làm: phân bổ hàng từ kho/lô cho điểm bán (`Allocation`), chuyển hàng giữa điểm bán (`Transfer`), xác nhận nhận (`TransferReceipt`); trạng thái `Transfer`: `created → in_transit → received | discrepancy`; chênh lệch số lượng khi nhận phải ghi nhận và xử lý.
- API: `POST /admin/allocations`, `POST /allocations/:id/next`, `POST /transfers`, `POST /transfers/:id/receive` (có số lượng thực nhận).
- DoD: tổng tồn trước/sau chuyển bảo toàn (test); nhận thiếu tạo `discrepancy` và cảnh báo.

### [ ] P4.42 Ghi nhận bán (`sale`) – POS
- API: `POST /retail/sales` (nhập tay), `POST /retail/sales/import` (CSV, có xem trước + kiểm lỗi), `POST /retail/sales/scan` (QR), `POST /retail/pos-sync` (nếu có tích hợp).
- Quy tắc: kiểm tra tồn tại điểm bán, **cấm bán âm**, chống ghi trùng (khóa theo mã giao dịch/nguồn; import có `SaleImport` hash file), cho phép hủy/điều chỉnh bằng giao dịch đảo (không xóa), mỗi dòng bán có giá thực tế để đối soát.
- Việc làm riêng CSV: mẫu file, báo dòng lỗi (SKU lạ, số âm, ngày sai), nhập từng phần hoặc hủy cả file.
- DoD: test bán vượt tồn, import trùng, import lỗi một phần.

### [ ] P4.43 Kho và tái nhập (`stock`, `inventory`)
- Việc làm: `InventoryMovement` chỉ thêm (nhập, xuất, chuyển, điều chỉnh, hàng lỗi/trả), `InventoryBalance` cập nhật cùng transaction; kiểm kê (`StockCount`) tạo điều chỉnh có lý do; cảnh báo tồn thấp; **tái nhập** (đề nghị bổ sung hàng từ chương trình/lô khác).
- API: `GET /inventory?store=&sku=`, `POST /inventory/adjustments` (cần lý do + duyệt), `POST /inventory/restock-requests`.
- DoD: tồn = tổng movement (test); điều chỉnh không xóa lịch sử.

### [ ] P4.44 Đối soát bán giùm (`settle`)
- Việc làm: kỳ đối soát (tuần/tháng cấu hình): doanh thu bán, **tiền cần nộp lại**, khoản được hưởng, công nợ; trạng thái `Settlement`: `draft → confirmed_by_retailer → approved → paid | disputed`; bất đồng thì mở tranh chấp; thanh toán qua luồng tiền 4B.
- API: `GET /retail/settlements`, `POST /retail/settlements/:id/confirm`, `POST /retail/settlements/:id/dispute`, `POST /admin/settlements/:id/approve`.
- DoD: số liệu khớp `Sale` và sổ cái.

### [ ] P4.45 Hàng lỗi/đổi trả của điểm bán
- Việc làm: yêu cầu trả/đổi kèm ảnh; duyệt; nhập lại kho hoặc hủy; ảnh hưởng tới tồn và đối soát.
- API: `POST /retail/returns`, `POST /admin/retail-returns/:id/approve|reject`.
- DoD: tồn và đối soát cập nhật đúng.

## 4D.2 Vận hành nội bộ

### [ ] P4.46 Kiểm tra thực địa (`inspection`)
- Việc làm: inspector nhập **tồn kiểm đếm thực tế** theo điểm bán, ảnh, ghi chú; hệ thống so với tồn hệ thống, tạo báo cáo chênh lệch, cảnh báo ngưỡng; chênh lệch lớn mở điều tra/điều chỉnh có duyệt; dùng tốt trên điện thoại, ảnh nén trước khi tải.
- API: `POST /inspector/visits`, `POST /inspector/visits/:id/counts`, `POST /inspector/visits/:id/photos`, `GET /admin/inspection-reports`.
- DoD: báo cáo chênh lệch đúng số học; ảnh lưu có kiểm soát truy cập.

### [ ] P4.47 QC lô hàng
- Việc làm: mẫu checklist theo ngành hàng (`QcChecklistTemplate`), `QcReport` (kết quả từng mục, ảnh/video, đạt/không đạt, lỗi phát hiện); không đạt → quy trình xử lý lỗi (yêu cầu NCC khắc phục, giảm giá, từ chối lô, bồi hoàn); kết quả điều khiển chuyển trạng thái đơn (4A) và lô (4C).
- API: `POST /inspector/qc-reports`, `POST /admin/qc-reports/:id/decision`.
- DoD: QC không đạt chặn chuyển bước (test).

### [ ] P4.48 Sức mua thị trường và dự báo (`intelligence`, `forecast`)
- Việc làm: tổng hợp từ **dữ liệu bán thật** (không số mẫu): tốc độ bán theo SKU/khu vực/điểm bán, dự báo nhu cầu (bắt đầu bằng trung bình trượt/đường xu hướng, có tham số `horizon`, `lead` như `settings` demo), gợi ý lượng nhập lô tiếp theo; gắn nhãn "dự báo, không phải cam kết".
- API: `GET /reports/intelligence?sku=&from=&to=`, `GET /reports/forecast`.
- DoD: dữ liệu rỗng hiển thị trạng thái rỗng, không bịa số.

### [ ] P4.49 Mạng lưới / CRM (`network`)
- Việc làm: danh sách liên hệ (khách, NCC, cửa hàng tiềm năng), lịch sử tương tác, pipeline theo giai đoạn, nhắc việc, KPI cơ bản cho sales; liên kết với yêu cầu tìm nguồn và người dùng.
- API: `CRUD /admin/crm/contacts`, `POST /admin/crm/contacts/:id/activities`, `GET /admin/crm/pipeline`.
- DoD: sales chỉ thấy liên hệ được giao (trừ admin).

### [ ] P4.50 Hỗ trợ tiếp cận vốn (`funding`) 🔒 D10
- Việc làm (nếu giữ): đơn đăng ký (doanh nghiệp, vốn đề nghị — demo dùng CNY, tài liệu), trạng thái `submitted → reviewing → need_more_docs → forwarded → decided(approved/declined)`; **ghi rõ CVC không phải tổ chức cấp tín dụng**; chuyển hồ sơ cho bên thẩm định; không cam kết cấp vốn.
- API: `POST /funding/applications`, `GET /funding/applications`, `POST /admin/funding/applications/:id/forward|decision`.
- DoD: văn bản miễn trừ hiển thị và lưu cùng đơn.

### [ ] P4.51 Trade Showroom (`showroom`)
- Việc làm: đặt lịch tham quan (`ShowroomVisit`: người đặt, ngày giờ, số người, mục đích), admin duyệt/đổi lịch, nhắc lịch, kiểm tra trùng lịch/sức chứa.
- API: `POST /showroom/visits`, `GET /showroom/slots`, `POST /admin/showroom/visits/:id/confirm|reschedule|cancel`.
- DoD: không đặt trùng khung đã đầy.

### [ ] P4.52 Tin nhắn người dùng ↔ CVC, thông báo (`messages`, `notifications`)
- Việc làm: kênh hỗ trợ (ticket/chat) giữa người dùng và CVC (tách khỏi Deal Room); phân công nhân viên, trạng thái `open → pending → resolved`; thông báo trong app dùng engine P2.18.
- API: `POST /support/tickets`, `GET /support/tickets`, `POST /support/tickets/:id/messages`, `POST /admin/support/tickets/:id/assign|resolve`.
- DoD: người dùng chỉ thấy ticket của mình.

### [ ] P4.53 Báo cáo (`reports`)
- Việc làm: báo cáo theo vai trò (khách: đơn/chi phí; mua hộ: lô/lợi nhuận/hoàn; bán giùm: doanh thu/hưởng/tồn; NCC: đơn/doanh thu; admin: tổng quan, tài chính, vận hành); bộ lọc kỳ; xuất Excel/PDF; truy vấn nặng chạy nền, cache.
- API: `GET /reports/:type?from=&to=`, `POST /reports/:type/export` (job nền, trả link tải).
- DoD: số liệu khớp nguồn (sổ cái, `Sale`, `InventoryMovement`); xuất file đúng quyền.

---

## DoD Phase 4D
- [ ] Bán giùm chạy E2E: đăng ký → ký → nhận hàng → bán (nhập tay + CSV) → chuyển hàng → kiểm đếm → đối soát → nhận tiền.
- [ ] Tồn kho bảo toàn qua mọi chuyển động; kiểm kê/chênh lệch có báo cáo.
- [ ] Toàn bộ test demo còn lại đã port.

---


# Phase 5 – Tích hợp bên thứ 3 và vận hành thủ công 🔌 (P5.1 – P5.23)

> **Đã chốt (D13):** thanh toán/chi tiền, eKYC và vận chuyển làm **thủ công**; không tích hợp cổng thanh toán/webhook, eKYC tự động, API hãng vận chuyển. Các task P5.9–P5.17 và P5.21 bên dưới được viết theo cách thủ công. Tích hợp tự động nằm ở Backlog.

## Nguyên tắc chung cho mọi tích hợp
1. **Lớp adapter riêng** (interface + implementation + mock): ví dụ `PaymentProvider`, `ContractProvider`, `EkycProvider`, `SmsProvider`, `EmailProvider`, `InvoiceProvider`, `ShippingProvider`, `TranslationProvider`. Đổi nhà cung cấp chỉ đổi implementation.
2. Dev/test dùng **mock**; staging dùng **sandbox**; production dùng khóa thật. Không gọi dịch vụ thật từ test.
3. Mọi lời gọi ra ngoài: timeout, retry có backoff (chỉ với thao tác idempotent), circuit breaker cơ bản, log request-id (che dữ liệu nhạy cảm).
4. Webhook vào: xác thực chữ ký/secret, kiểm tra thời gian (chống replay), ghi sự kiện thô trước (`ProviderEvent`), xử lý **idempotent**, trả 2xx nhanh rồi xử lý nền.
5. Mỗi tích hợp có tài liệu `docs/integrations/<tên>.md`: mục đích, endpoint dùng, biến môi trường, cách test sandbox, quy trình xử lý sự cố, người liên hệ, hạn mức/phí.
6. Cấu hình khóa qua env; khóa production chỉ trên server.

---

## 5.1 Hợp đồng điện tử và chữ ký số (Viettel vContract/MySign hoặc nhà cung cấp đã chọn ở D11)

### [ ] P5.1 Đăng ký và nhận tài liệu
- Việc làm: ký hợp đồng dịch vụ, nhận tài khoản sandbox, tài liệu API, thông tin webhook; ghi vào `docs/integrations/contract.md`.
- DoD: gọi được API sandbox ("hello world": tạo hợp đồng thử).

### [ ] P5.2 Chứng thư số công ty 🔒 D2
- Việc làm: nếu CVC là bên ký: mua chứng thư số **ký từ xa/HSM** (không dùng USB token vì web chạy trên server); đăng ký người đại diện pháp luật; thử ký bằng API.
- DoD: ký thử một tài liệu bằng chứng thư công ty ở sandbox.

### [ ] P5.3 Adapter hợp đồng
- Interface `ContractProvider`: `createFromTemplate(templateId, variables, parties)`, `send(contractId)`, `getStatus(contractId)`, `download(contractId)`, `cancel(contractId)`; webhook `contract.signed|declined|expired`.
- Việc làm: implement thật + mock; lưu `providerRef`; xử lý lỗi/timeout; đồng bộ trạng thái bằng webhook và job đối chiếu định kỳ.
- DoD: test mock đủ trạng thái; một lần chạy thật ở sandbox.

### [ ] P5.4 Mẫu hợp đồng
- Việc làm: 3 mẫu có biến — `sourcing` (Tìm nguồn), `participation` (Mua hộ: số lượng, giá trị, điều kiện 45 ngày + 3%, cảnh báo rủi ro), `retail` (Bán giùm: khoản được hưởng, nhận hàng, đối soát); `ContractTemplate` có version; nội dung do luật sư duyệt (C5); điền tự động từ dữ liệu đơn (`contractText` trong demo là điểm tham chiếu).
- DoD: render thử từng mẫu với dữ liệu thật; version cũ vẫn tra cứu được.

### [ ] P5.5 Ký nhiều bên
- Việc làm: ký theo thứ tự (ví dụ khách → NCC → CVC nếu có); cá nhân ký bằng OTP/eKYC/SmartCA; nhắc người chưa ký; hết hạn ký → hợp đồng `expired` và đơn quay về bước trước; ký từ chối → thông báo.
- API: `POST /contracts/:id/send`, `GET /contracts/:id`, `GET /contracts/:id/sign-url` (chuyển hướng/nhúng).
- DoD: test thứ tự ký, hết hạn, từ chối.

### [ ] P5.6 Lưu bản đã ký
- Việc làm: tải bản đã ký về lưu S3 (bucket riêng), lưu `fileHash` (SHA-256) + dấu thời gian; liên kết với `Order`/`Participation`/`RetailerRegistration`; **khóa nội dung** sau khi ký; người liên quan tải được qua link ký có hạn.
- DoD: tải lại so hash khớp; không sửa được hợp đồng đã ký.

### [ ] P5.7 Ký với nhà cung cấp nước ngoài 🔒 D9
- Việc làm: theo kết luận luật sư/nhà cung cấp: phương án ký cho bên Trung Quốc (hợp đồng song ngữ, ký điện tử dạng khác, hoặc quy trình ký giấy rồi tải bản quét lên với xác nhận); cài phương án được chọn như một "phương thức ký" thay thế trong adapter.
- DoD: luồng ký hoàn tất được với NCC nước ngoài ở staging.

### [ ] P5.8 Thay thế `sign` giả lập
- Việc làm: thay hàm `sign` trong `buyer-flow.js` và `participant-flow.js` (port) bằng luồng thật (tạo → gửi → chờ webhook → đã ký); bỏ nút "ký thử".
- DoD: không còn đường ký giả lập ngoài môi trường test.

---

## 5.2 Thanh toán thủ công bằng ảnh minh chứng ⚠️ 🔒 D1/D3

### [ ] P5.9 Quản lý tài khoản ngân hàng nhận tiền 🔒 D3
- Việc làm: `ReceivingAccount` (ngân hàng, số tài khoản, chủ tài khoản, mục đích: cọc/mua hộ/phí/khác, hiệu lực); chỉ `admin_super` thêm/sửa, mọi thay đổi ghi audit và **duyệt hai lớp**; người dùng chỉ thấy tài khoản **do hệ thống hiển thị** (cảnh báo "không chuyển vào số tài khoản gửi qua chat"); lưu lịch sử thay đổi.
- DoD: đổi tài khoản nhận tiền phải duyệt hai lớp; người thường không sửa được (test).

### [ ] P5.10 Yêu cầu thanh toán và mã tham chiếu
- Việc làm: mỗi `Payment` có **mã tham chiếu duy nhất** (ví dụ `CVC-ORD-000123-C1`) làm nội dung chuyển khoản; hiển thị tài khoản nhận, số tiền, nội dung (nút sao chép) và **mã VietQR sinh phía server** từ thông tin tài khoản + số tiền + nội dung (dùng chuẩn VietQR, không gọi dịch vụ thu phí); hạn nộp minh chứng cấu hình được; hết hạn → `expired`.
- DoD: mã tham chiếu không trùng; QR quét ra đúng số tiền và nội dung; yêu cầu hết hạn bị vô hiệu.

### [ ] P5.11 Nộp ảnh minh chứng
- Việc làm: tải 1–N ảnh (jpg/png/webp/pdf) hoặc chụp trực tiếp bằng điện thoại; kiểm tra MIME thật, kích thước tối thiểu để đọc rõ, giới hạn dung lượng, nén nhưng không làm mờ chữ; khai số tiền, thời điểm chuyển, ngân hàng gửi, mã giao dịch; lưu `PaymentProof` + **hash ảnh** (chặn dùng lại ảnh cũ hoặc ảnh của giao dịch khác); trạng thái `proof_submitted`, thông báo admin; người dùng xem lại ảnh đã nộp và trạng thái; **không có nút "đã thanh toán" nếu chưa có ảnh**.
- DoD: test ảnh trùng, sai định dạng, quá lớn; không sửa/xóa ảnh sau khi nộp (nộp thêm thì tạo bản ghi mới).

### [ ] P5.12 Hàng đợi duyệt minh chứng của admin tài chính
- Việc làm: danh sách chờ duyệt (hiển thị SLA, quá hạn tô đỏ), xem ảnh phóng to cạnh thông tin yêu cầu; **checklist đối chiếu** (đúng tài khoản nhận, đúng số tiền, đúng nội dung/mã, thời điểm hợp lệ, ảnh không trùng, tiền đã về trong sao kê); thao tác: duyệt (nhập số tiền thực nhận), duyệt một phần, từ chối (lý do), yêu cầu bổ sung; **duyệt hai lớp** trên ngưỡng (người duyệt 2 khác người duyệt 1); khi duyệt **ghi sổ cái** idempotent và cập nhật đơn/tham gia; thông báo người dùng; audit; ảnh đã duyệt lưu bất biến.
- DoD: duyệt hai lần chỉ ghi sổ một lần; một người không tự duyệt cả hai lớp; test từng nhánh.

### [ ] P5.13 Chi tiền thủ công (trả NCC, hoàn tiền, rút tiền)
- Việc làm: quy trình chung cho P4.20, P4.26, P4.36: tạo `Payout` → duyệt → admin chuyển khoản ngoài hệ thống → `mark-paid` kèm **ảnh minh chứng chi** + mã giao dịch → bên nhận xác nhận (hoặc tự xác nhận sau N ngày) → ghi sổ cái; chống chi trùng (khóa theo reference); tên chủ tài khoản phải khớp tài khoản đã xác minh; nhắc admin các khoản chờ chi quá hạn.
- DoD: không chi/ghi trùng; sổ cái đúng; bên nhận xem được ảnh minh chứng chi.

### [ ] P5.14 Thanh toán quốc tế/CNY thủ công 🔒 D6
- Việc làm: CVC/NCC tự xử lý chuyển tiền quốc tế ngoài hệ thống; hệ thống chỉ lưu chứng từ (ảnh/PDF), **tỷ giá chốt nhập tay có duyệt** (`ExchangeRate` ghi ai nhập, khi nào), số tiền theo từng đồng tiền, phí; đối chiếu thủ công.
- DoD: giao dịch CNY ghi đúng hai đồng tiền và tỷ giá chốt; sổ cái cân bằng theo từng `currency`.

### [ ] P5.15 Đối soát sao kê ngân hàng
- Việc làm: dùng P4.27; thêm job nhắc admin tải sao kê hằng ngày; cảnh báo **minh chứng đã duyệt nhưng không có tiền về** sau N ngày (nghi ảnh giả); báo cáo lệch hằng ngày gửi admin tài chính.
- DoD: kịch bản có dòng lệch/ảnh giả được phát hiện và hiển thị cảnh báo.

### [ ] P5.16 Xử lý ca đặc biệt
- Việc làm: quy trình và test cho: ảnh giả/chỉnh sửa, chuyển thiếu/thừa, sai nội dung, chuyển từ tài khoản người khác, nộp trễ, nộp trùng, duyệt nhầm (bút toán đảo + thông báo), hoàn tiền thủ công; hướng dẫn cho admin trong runbook (O10).
- DoD: mỗi ca có test hoặc hướng dẫn xử lý.

---

## 5.3 Dịch vụ khác

### [ ] P5.17 eKYC: duyệt tay, chưa tích hợp
- Việc làm: không tích hợp nhà cung cấp eKYC; dùng quy trình xác minh bằng ảnh + duyệt tay ở P2.13–P2.14; giữ interface `EkycProvider` để sau này cắm tự động (Backlog).
- DoD: không có phụ thuộc eKYC bên ngoài; quy trình duyệt tay đạt DoD của P2.14.

### [ ] P5.18 SMS/OTP/Zalo ZNS
- Việc làm: đăng ký brandname/template (có thời gian duyệt, làm sớm); adapter `SmsProvider` + `ZnsProvider` với failover (ZNS → SMS); log gửi (không lưu nội dung OTP); chống lạm dụng (giới hạn theo số/IP); báo cáo chi phí.
- DoD: gửi OTP thật ở staging; template được duyệt.

### [ ] P5.19 Email giao dịch
- Việc làm: cấu hình domain gửi (SPF, DKIM, DMARC), adapter `EmailProvider` (SES/SendGrid/Resend), template responsive đa ngôn ngữ, xử lý bounce/complaint (webhook → đánh dấu email lỗi), trang hủy đăng ký cho thông báo không bắt buộc.
- DoD: email vào hộp thư chính (không spam) với 3 nhà cung cấp hộp thư phổ biến; kiểm tra điểm bằng công cụ chấm email.

### [ ] P5.20 Hóa đơn điện tử
- Việc làm: adapter `InvoiceProvider` (Viettel S-Invoice/MISA/VNPT): xuất hóa đơn cho **phí dịch vụ CVC** (không cho tiền hàng nếu D1 quy định khác), lưu mã tra cứu, gửi email, hủy/điều chỉnh/thay thế đúng quy định; đồng bộ với `Invoice`.
- DoD: xuất hóa đơn thử ở sandbox; kế toán xác nhận.

### [ ] P5.21 Vận chuyển: tự đặt hãng ngoài, tracking nhập tay
- Việc làm: không tích hợp API hãng; NCC/CVC/khách tự đặt hãng (GHN, GHTK, Viettel Post, hãng quốc tế...); hệ thống lưu `Shipment` (hãng nhập tay, mã vận đơn, link tra cứu, ngày gửi/dự kiến, ảnh phiếu) và **mốc nhập tay** (`ShipmentStop`/`SampleStop`) theo P4.17, P4.19; danh sách mốc gợi ý (`shippingStops`, `sampleStops`) để chọn nhanh; phân quyền ai được nhập; job nhắc khi quá N ngày chưa cập nhật; khách xem timeline và mở link tra cứu trên trang của hãng.
- DoD: toàn bộ luồng vận chuyển chạy không cần API ngoài.

### [ ] P5.22 Dịch AI
- Việc làm: adapter `TranslationProvider` (API Claude hoặc dịch vụ dịch); prompt dịch giữ nguyên số liệu/đơn vị/mã SKU; cache theo (nội dung, ngôn ngữ); giới hạn chi phí theo người dùng/ngày; ghi nhãn "dịch tự động".
- DoD: dịch Trung–Việt đúng số và thuật ngữ ngành hàng mẫu; vượt hạn mức báo lỗi rõ.

### [ ] P5.23 Lưu trữ file và CDN
- Việc làm: S3 (hoặc tương đương) cho production, bucket tách: công khai (ảnh sản phẩm qua CDN), riêng tư (KYC, hợp đồng, ảnh minh chứng thanh toán/chi, chứng từ); chính sách vòng đời, mã hóa phía máy chủ, CORS đúng; Cloudflare/CDN cho ảnh công khai (cache, nén avif/webp).
- DoD: ảnh sản phẩm tải nhanh, tệp riêng tư không truy cập công khai được.

---

## DoD Phase 5
- [ ] Mỗi tích hợp: test mock + một lần chạy thật ở sandbox + tài liệu `docs/integrations/<tên>.md`.
- [ ] Đường ký/thanh toán giả lập chỉ còn trong môi trường test.
- [ ] Thanh toán, chi tiền, eKYC, vận chuyển thủ công đã có test và hướng dẫn vận hành.
- [ ] Sự cố bên thứ 3 (timeout, lỗi) được xử lý, không làm treo đơn/tiền.

---


# Phase 6A – Frontend: nền tảng, design system, trang công khai, auth (F1 – F18)

Port UX từ demo: `app.js`, `styles.css`, `buyer.css`, `participant.css`, `sourcing.css`, `vendor.css`, `service-banners.css`. Frontend gọi **API thật**; không dùng `localStorage` cho dữ liệu nghiệp vụ.

Mỗi màn hình bắt buộc có: loading (skeleton), empty, error (nút thử lại), no-permission, responsive từ 360px.

## 6A.1 Nền tảng

### [ ] F1 Khởi tạo `apps/web`
- Stack: Vite + React + TS strict, React Router (route lazy), TanStack Query, React Hook Form + Zod, Tailwind, Socket.IO client.
- Cấu trúc: `src/app` (router, providers), `src/features/<module>` (api, hooks, components, pages), `src/components/ui`, `src/lib` (format, api client, i18n), `src/styles`.
- DoD: build + dev chạy; alias `@/`, `@cvc/shared` hoạt động.

### [ ] F2 Design tokens
- Việc làm: đọc `styles.css` demo, rút màu, font, bán kính, bóng, khoảng cách thành token (CSS variables + Tailwind theme); font web có font hệ thống dự phòng (không chặn hiển thị).
- DoD: một trang "style guide" nội bộ (`/_styleguide`, ẩn ở production) hiển thị mọi token và component.

### [ ] F3 Thư viện component
- Danh sách: Button, IconButton, Input, Textarea, Select, Combobox, Checkbox, Radio, Switch, NumberInput (VND/CNY), DatePicker, Modal/Drawer, Toast, Table (sắp xếp, phân trang), Tabs, Stepper, Progress, Badge/Status, Card, Metric, Empty, Notice (info/warning/danger), FormField, FileUpload (kéo thả, xem trước, tiến trình), ImageGallery, Chart (đường, cột), Skeleton, Pagination, Breadcrumb, Avatar, Tooltip, ConfirmDialog.
- Port ý tưởng từ helper trong `app.js` (`badge`, `metric`, `table`, `stepper`, `progress`, `notice`, `field`, `select`, `form`, `empty`).
- DoD: mỗi component có story/ví dụ trong style guide; bàn phím + ARIA đúng.

### [ ] F4 Icon, logo, ảnh
- Việc làm: port `iconPaths`/`ic` thành bộ icon SVG; logo (`logo()`); ảnh banner 3 dịch vụ (`assets/banners/service-1..3.png`) tối ưu lại; favicon, ảnh chia sẻ mạng xã hội.
- DoD: icon dùng nhất quán, không nhúng ảnh nặng.

### [ ] F5 Layout
- Việc làm: `PublicLayout` (header + footer), `AppLayout` (header + sidebar theo vai trò + vùng nội dung), `AuthLayout`; sidebar dựng từ cấu hình `roleNav` (port: buyer, participant, retailer, supplier, sales, inspector, admin); điều hướng mobile (bottom bar/drawer); chọn dịch vụ nhanh trên mobile (tương đương `mobileServicesNav`); breadcrumb.
- DoD: mỗi vai trò thấy đúng menu; menu mobile dùng được một tay.

### [ ] F6 Giao diện xác thực
- Màn: đăng ký (email/SĐT), đăng nhập, nhập OTP, quên mật khẩu, đặt lại mật khẩu, bật/nhập 2FA, quản lý phiên/thiết bị, đổi mật khẩu; hồ sơ + KYC (upload CCCD mặt trước/sau + ảnh chân dung cầm CCCD (có hướng dẫn chụp), ĐKKD, trạng thái duyệt, nhắc bổ sung).
- Việc làm: lưu token an toàn (access trong bộ nhớ, refresh qua cookie HttpOnly nếu backend hỗ trợ), tự refresh, đăng xuất mọi tab, hiển thị lỗi rõ ràng (sai mật khẩu, bị khóa tạm).
- DoD: luồng đăng ký → xác minh → đăng nhập → KYC hoàn chỉnh trên desktop và mobile.

### [ ] F7 Bảo vệ route theo vai trò
- Việc làm: `RequireAuth`, `RequireRole`, `RequireKyc`; điều hướng sau đăng nhập theo vai trò; chọn **vai trò đang dùng** cho người nhiều vai trò (thay bộ chuyển DEMO); trang 403, 404, 500, mất mạng, bảo trì.
- DoD: truy cập trực tiếp URL không được phép → 403/chuyển hướng đúng; test E2E.

### [ ] F8 API client
- Việc làm: dùng client sinh từ OpenAPI (P1.7); wrapper xử lý lỗi chuẩn `{code,message,requestId}`, thử lại có điều kiện, hủy request khi rời trang; gắn `Idempotency-Key` cho POST tiền; hiển thị `requestId` ở trang lỗi để hỗ trợ.
- DoD: không còn `fetch` rời rạc; mọi lỗi API đi qua một chỗ.

### [ ] F9 Đa ngôn ngữ
- Việc làm: i18next (vi mặc định, en, zh); tách chuỗi khỏi component; định dạng tiền/ngày/số theo locale; hiển thị VND/CNY thống nhất qua một hàm `formatMoney`; ngôn ngữ lưu theo tài khoản.
- DoD: đổi ngôn ngữ không còn chuỗi cứng sót (kiểm tra bằng script quét).

### [ ] F10 Responsive và PWA
- Việc làm: kiểm thử 360/768/1024/1440px; PWA (manifest, service worker, cài lên màn hình); offline tối thiểu cho POS (hàng đợi ghi bán, đồng bộ lại khi có mạng, chống ghi trùng); khung xem điện thoại của demo (`xem-thu.html`) không mang sang.
- DoD: Lighthouse PWA đạt; POS ghi bán offline rồi đồng bộ đúng.

### [ ] F11 Accessibility
- Việc làm: điều hướng bàn phím, focus rõ, nhãn ARIA, tương phản đạt WCAG AA, `prefers-reduced-motion`, dark mode (nếu giữ).
- DoD: quét axe không lỗi nghiêm trọng ở các trang chính.

### [ ] F12 Gỡ phần DEMO
- Việc làm: không có nhãn "DEMO", bộ chuyển vai trò, màn "Thiết lập demo", tour hướng dẫn demo (`tours`), `xem-thu.html`, dữ liệu mẫu cứng; thay tour bằng hướng dẫn thật (C7) nếu cần.
- DoD: `grep -ri "demo"` trong `apps/web/src` chỉ còn comment hợp lý hoặc trong style guide ẩn.

## 6A.2 Trang công khai

### [ ] F13 Trang chủ
- Nội dung (port `home`, `welcome`, `service-banners`): hero, trình chiếu 3 dịch vụ (Tìm nguồn hàng, Mua hộ, Bán giùm) có điều khiển và tự chạy, mô tả ngắn từng dịch vụ + CTA, quy trình, đối tác, FAQ ngắn, footer pháp lý.
- DoD: LCP tốt trên mobile; carousel dừng khi người dùng tương tác, hỗ trợ bàn phím.

### [ ] F14 Khám phá nguồn hàng
- Màn: danh sách (`market`), chi tiết (`product`, `supplierStore` bản công khai): bộ lọc danh mục, tìm kiếm bỏ dấu, phân trang, thẻ sản phẩm (`productCard`), bộ ảnh (`reference-galleries`), thông số, CTA "Gửi yêu cầu tìm nguồn"; banner đối tác nhà cung cấp/vận chuyển trước danh sách.
- Ràng buộc: **không hiển thị giá mua, nhà cung cấp**; chỉ thông tin API công khai trả.
- DoD: tìm "ao mua" ra kết quả; URL lọc chia sẻ được.

### [ ] F15 Trang giới thiệu 3 dịch vụ
- Nội dung: quy trình từng dịch vụ (Tìm nguồn: 8 giai đoạn; Mua hộ: 7 bước; Bán giùm), điều kiện, khoản hưởng minh họa, **cảnh báo rủi ro rõ**, không cam kết lợi nhuận; CTA đăng ký theo vai trò.
- DoD: nội dung được sếp/luật sư duyệt (D9, C4).

### [ ] F16 Trang pháp lý
- Trang: điều khoản sử dụng, chính sách bảo mật, quy chế hoạt động, chính sách hoàn tiền/khiếu nại, cảnh báo rủi ro Mua hộ, điều khoản từng dịch vụ; người dùng phải **đồng ý khi đăng ký** (lưu phiên bản + thời điểm đồng ý).
- DoD: lưu bằng chứng đồng ý theo phiên bản.

### [ ] F17 Liên hệ, hỗ trợ, Showroom
- Màn: liên hệ (form + thông tin), trung tâm trợ giúp/FAQ có tìm kiếm, Trade Showroom (giới thiệu + đặt lịch tham quan `showroom`/`visit`).
- DoD: form liên hệ chống spam (CAPTCHA/honeypot) và gửi vào ticket.

### [ ] F18 SEO
- Việc làm: meta + Open Graph cho từng trang, `sitemap.xml`, `robots.txt`, dữ liệu có cấu trúc (Product, Organization, FAQ), URL thân thiện (`/san-pham/:slug`), canonical; cân nhắc prerender/SSR cho trang công khai (Vite SSG hoặc chuyển phần công khai sang Next.js nếu SEO là ưu tiên).
- DoD: trang công khai hiển thị đúng khi tắt JS ở mức nội dung chính (nếu chọn prerender); điểm SEO Lighthouse ≥ 90.

---

## DoD Phase 6A
- [ ] Người lạ vào trang chủ, xem danh mục, đọc điều khoản, đăng ký, KYC — trên desktop và mobile.
- [ ] Không còn dấu vết DEMO.
- [ ] Style guide đầy đủ, accessibility cơ bản đạt.

---


# Phase 6B – Frontend: trang theo vai trò và admin (F19 – F61)

Quy ước route (đề xuất), mỗi trang có vai trò được phép:

| Vai trò | Prefix route |
|---|---|
| buyer (khách tìm nguồn) | `/app/buyer/...` |
| participant (mua hộ) | `/app/participant/...` |
| retailer (bán giùm) | `/app/retailer/...` |
| supplier | `/app/supplier/...` |
| sales / inspector | `/app/staff/...` |
| admin | `/admin/...` |

Với mỗi màn: dữ liệu từ API (TanStack Query), form dùng Zod, trạng thái đủ (loading/empty/error/403), realtime nếu liệt kê.

## 6B.1 Khách tìm nguồn (`buyer`)

### [ ] F19 Tổng quan (`overview`)
- Hiển thị: đơn đang chạy theo giai đoạn, yêu cầu chờ báo giá/chờ chọn, thông báo mới, việc cần làm (ký, thanh toán, duyệt mẫu, xác nhận nhận hàng).
- DoD: mỗi thẻ dẫn thẳng tới hành động; số liệu khớp API.

### [ ] F20 Gửi yêu cầu tìm nguồn
- Form: tên sản phẩm, mô tả, ảnh (nhiều), thông số, số lượng, giá mục tiêu (tùy chọn), thị trường bán, thời hạn nhận báo giá; xem trước; lưu nháp.
- DoD: validate; gửi thành công chuyển tới trang chi tiết yêu cầu.

### [ ] F21 Danh sách, chi tiết, so sánh báo giá (`rfqs`, `rfq`, `compare`)
- Màn: danh sách yêu cầu (lọc trạng thái), chi tiết (timeline), **bảng so sánh báo giá** (đơn giá, MOQ, lead time, hiệu lực, điều kiện), chọn báo giá; báo giá hết hạn hiển thị mờ + không chọn được; hủy yêu cầu.
- DoD: không chọn được báo giá hết hạn; xác nhận trước khi chọn.

### [ ] F22 Deal Room (`orders`, `deal`, `dealContent`)
- Thành phần: khung chat realtime (gửi file/ảnh/video, hiển thị đã đọc, nút dịch từng tin), bảng đề nghị giá (đề nghị/đối đề nghị/chấp nhận), panel điều khoản (xem, khóa), danh sách thành viên, tab Mẫu / Hợp đồng / Thanh toán / Vận chuyển / Tiến độ.
- DoD: hai trình duyệt chat realtime; mất mạng tự nối lại, không mất tin chưa gửi.

### [ ] F23 Stepper tiến độ đơn
- Hiển thị **8 giai đoạn** gộp từ 10 trạng thái (D7): Trao đổi & chốt hàng → Duyệt mẫu → Hợp đồng → Đặt cọc → Chờ hàng hoàn tất → Thanh toán còn lại → Nhận hàng → Hoàn tất; mỗi bước nêu ai cần làm gì, hạn, nút hành động hợp lệ.
- DoD: nút chỉ hiện khi người dùng có quyền ở trạng thái hiện tại.

### [ ] F24 Mẫu thử
- Màn: yêu cầu mẫu, theo dõi vận chuyển mẫu (`sampleStops`: Nhà cung cấp đã gửi mẫu → Đang vận chuyển mẫu → Đang giao mẫu → Mẫu đã tới địa chỉ nhận), xem ảnh/video mẫu NCC gửi, duyệt hoặc yêu cầu sửa (kèm lý do).
- DoD: mẫu đã duyệt không còn nút sửa.

### [ ] F25 Ký hợp đồng
- Màn: xem nội dung hợp đồng, thông tin hai bên, nút ký → mở luồng ký của nhà cung cấp chữ ký số (nhúng hoặc chuyển hướng), theo dõi trạng thái ký từng bên, tải bản đã ký.
- DoD: sau khi ký xong trạng thái đồng bộ không cần tải lại trang.

### [ ] F26 Thanh toán bằng chuyển khoản + ảnh minh chứng
- Màn: thông tin khoản cần trả (cọc/còn lại, hạn); **tài khoản nhận** (ngân hàng, số tài khoản, chủ tài khoản), **số tiền**, **nội dung chuyển khoản bắt buộc** (nút sao chép từng mục), **mã VietQR**; cảnh báo "chỉ chuyển đúng tài khoản hiển thị ở đây"; form tải ảnh minh chứng (chụp trực tiếp hoặc chọn ảnh, xem trước, khai số tiền/thời điểm/ngân hàng gửi/mã giao dịch); trạng thái: chờ nộp → đã nộp, chờ duyệt → đã duyệt / từ chối (hiện lý do, cho nộp lại) / thiếu tiền (yêu cầu bù); đếm ngược hạn nộp; lịch sử và xem lại ảnh đã nộp.
- DoD: không có nút "tôi đã thanh toán" nếu chưa có ảnh; trạng thái cập nhật realtime khi admin duyệt; dùng tốt trên điện thoại (mở camera, ảnh đọc rõ).

### [ ] F27 Vận chuyển (nhập tay) và nhận hàng
- Màn: thông tin vận chuyển do NCC/CVC nhập (hãng, mã vận đơn, ngày gửi/dự kiến, ảnh phiếu), **link tra cứu mở trang của hãng**, timeline mốc nhập tay (có gợi ý `shippingStops`: CVC đã nhận đủ thanh toán → Hàng đã rời nhà máy → Đang vận chuyển quốc tế → Đang giao đến bạn → Đã tới địa chỉ nhận); hiển thị ai cập nhật và khi nào; xác nhận nhận hàng (kèm ảnh nếu có vấn đề), mở khiếu nại.
- DoD: xác nhận nhận hàng có hộp thoại xác nhận rõ hậu quả; cảnh báo nhẹ khi mốc lâu chưa cập nhật.

### [ ] F28 Khiếu nại (`claims`)
- Màn: tạo khiếu nại (lý do, chứng cứ ảnh/video), xem đề xuất phương án, chọn phương án, theo dõi bù tiền/trả hàng/hoàn tiền từng bước (`moveTopup`, `sendReturn`, `receiveReturn`, `confirmRefund`), lịch sử.
- DoD: mỗi trạng thái có hướng dẫn "bước tiếp theo".

### [ ] F29 Kho, báo cáo, hỗ trợ vốn
- Màn: kho và nhập lại (`inventory`), báo cáo của khách, hỗ trợ tiếp cận vốn (`funding`: đăng ký, trạng thái, miễn trừ rõ "CVC không phải tổ chức cấp tín dụng") nếu D10 giữ.
- DoD: văn bản miễn trừ luôn hiển thị.

## 6B.2 Bên mua hộ (`participant`)

### [ ] F30 Danh sách lô (`campaigns`, `campaignCard`)
- Thẻ lô: tên, ảnh, tiến độ góp (thanh %), hạn, giá trị tối thiểu, trạng thái; lọc/sắp xếp.
- DoD: lô đầy/hết hạn hiển thị đúng và không cho tham gia.

### [ ] F31 Chi tiết lô (`campaign`)
- Nội dung: danh sách hàng, giá vốn, tổng giá trị, khảo sát sức mua, giá bán, đầu ra, lợi nhuận **dự kiến** (có breakdown), rủi ro, điều kiện 45 ngày + 3%, timeline 7 bước; khối **cảnh báo rủi ro** nổi bật, **không viết cam kết lợi nhuận**.
- DoD: chữ "dự kiến"/"không cam kết" xuất hiện ở mọi chỗ có số lợi nhuận.

### [ ] F32 Tham gia lô
- Luồng: nhập số tiền → gọi `quote` → hiển thị số hàng nguyên mua được, phần dư, tổng phải trả → xác nhận → ký → chuyển khoản + tải ảnh minh chứng → chờ admin duyệt → thành công.
- Quy tắc: gửi kèm Idempotency-Key, khóa nút khi đang gửi, xử lý lỗi "hạn mức vừa hết" bằng hướng dẫn rõ ràng.
- DoD: E2E hai người tranh phần cuối, người thua nhận thông báo đúng.

### [ ] F33 "Container của tôi" (`my-container`)
- Hiển thị: stepper 7 bước (Đăng ký → Chốt đợt → Sản xuất → QC → Vận chuyển → Nhập kho → Phân hàng), ảnh/báo cáo tiến độ, hàng đã mua/đã xuất/đã bán/tồn, tiền thu về, lợi nhuận tạm tính.
- DoD: khớp API `overview`.

### [ ] F34 Nhận hàng kinh doanh hoặc bán giùm
- Màn: chọn "tự nhận" (điểm nhận, hẹn lịch) hoặc "đưa vào bán giùm" (chọn điểm bán, số lượng), xác nhận, theo dõi.
- DoD: không chọn quá số hàng được chia.

### [ ] F35 Ví và rút tiền
- Màn: số dư khả dụng/tạm giữ, lịch sử giao dịch, tài khoản ngân hàng đã xác minh, tạo yêu cầu rút (hạn mức/ngày hiển thị), trạng thái yêu cầu (chờ duyệt → đã chuyển, xem ảnh minh chứng chi), sao kê tải về.
- DoD: không cho rút khi chưa KYC; số tiền tạm giữ giải thích rõ.

### [ ] F36 Yêu cầu hoàn sau 45 ngày
- Màn: đếm ngược tới mốc đủ điều kiện, danh sách hàng đủ điều kiện, tạo yêu cầu hoàn, hiển thị **giá trị hàng hoàn** và **khoản cộng 3% (chỉ trên giá trị hàng hoàn)**, trạng thái từng bước.
- DoD: số tiền hiển thị khớp với phép tính backend.

### [ ] F37 Đối soát và sức mua
- Màn: đối soát (`settlements`), sức mua thị trường (`intelligence`) với biểu đồ từ dữ liệu thật; trạng thái rỗng rõ ràng khi chưa có dữ liệu.
- DoD: không số liệu bịa khi dữ liệu trống.

## 6B.3 Bên bán giùm (`retailer`)

### [ ] F38 Khám phá hàng bán giùm (`retail-catalog`, `retail-product`)
- Hiển thị: thẻ hàng (`resaleCard`), giá bán, **khoản được hưởng**, số còn, điều kiện; chi tiết + nút đăng ký nhận bán.
- DoD: khoản hưởng khớp API theo lô.

### [ ] F39 Tài khoản bán giùm (`retail`)
- Màn: đăng ký số lượng, ký thỏa thuận, trạng thái đăng ký, hàng nhận/đã bán/tồn/doanh thu/tiền cần đối soát/khoản được hưởng; chọn điểm bán (`storeSelector`).
- DoD: số liệu khớp `Sale`/`Settlement`.

### [ ] F40 POS / Scan to Sell (`pos`)
- Tab: **QR Scan** (camera, xin quyền rõ ràng, nhập tay khi từ chối), **Nhập tay**, **Import CSV** (tải mẫu, xem trước, báo dòng lỗi, xác nhận), **POS Sync** (nếu có tích hợp).
- Yêu cầu: dùng tốt một tay trên điện thoại; số lượng bán tối đa = tồn; thông báo thành công/lỗi rõ; hỗ trợ offline (F10).
- DoD: quét → ghi bán → tồn giảm; import trùng bị chặn.

### [ ] F41 Nhận hàng điều phối (`allocation`, `transfer`)
- Màn: danh sách phân bổ/chuyển đến điểm bán, xác nhận nhận với số lượng thực nhận, báo chênh lệch; chuyển hàng giữa điểm bán.
- DoD: nhận thiếu tạo cảnh báo và hiển thị ở admin.

### [ ] F42 Đối soát, rút tiền, báo cáo
- Màn: kỳ đối soát, xác nhận hoặc phản đối, rút khoản được hưởng, báo cáo doanh thu/hoa hồng/hàng chậm bán.
- DoD: phản đối mở tranh chấp có chứng cứ.

## 6B.4 Nhà cung cấp (`supplier`)

### [ ] F43 Quản lý sản phẩm (`supplier`)
- Màn: danh sách, thêm/sửa/ẩn, tải ảnh, thông số, MOQ, lead time; trạng thái chờ duyệt (nếu có).
- DoD: chỉ thấy sản phẩm của mình.

### [ ] F44 Yêu cầu và báo giá
- Màn: yêu cầu phù hợp/được mời, form báo giá (đơn giá, MOQ, lead time, hiệu lực, điều kiện giao), sửa/rút báo giá, trạng thái (đang chờ/được chọn/không được chọn).
- DoD: yêu cầu hết hạn không báo giá được.

### [ ] F45 Đơn của NCC
- Màn: Deal Room (như F22 nhìn từ NCC), mẫu (gửi mẫu, mốc vận chuyển), hợp đồng, tiến độ sản xuất (báo cáo kèm ảnh/video), thông báo "sẵn sàng giao", nhập thông tin vận chuyển (hãng tự đặt, mã vận đơn, mốc).
- DoD: các nút hành động chỉ hiện đúng bước.

### [ ] F46 Tin nhắn, thông báo, hồ sơ NCC
- Màn: hộp thư với CVC, thông báo, hồ sơ nhà cung cấp (thông tin pháp lý, tài khoản nhận tiền).
- DoD: đổi tài khoản nhận tiền cần xác minh lại.

## 6B.5 Nội bộ CVC

### [ ] F47 Kinh doanh (`sales`)
- Màn: pipeline yêu cầu (kéo-thả hoặc bảng), phân công, ghi chú nội bộ, CRM (`network`), mời NCC báo giá, tạo/đăng lô, nhập mốc vận chuyển (quốc tế/nhập kho/giao nội địa), báo cáo cá nhân.
- DoD: chỉ thấy dữ liệu được giao.

### [ ] F48 Kiểm tra thực địa (`inspector`)
- Màn: chọn điểm bán, nhập tồn kiểm đếm, chụp/tải ảnh (nén trước), ghi chú, gửi; xem báo cáo chênh lệch; tạo QC lô (checklist).
- DoD: dùng tốt trên điện thoại, gửi lại được khi mạng yếu.

### [ ] F49 Admin: bảng điều khiển
- Thẻ: doanh thu phí, lô đang chạy, yêu cầu chờ xử lý, đơn quá hạn, dòng tiền (thu/chi/đang giữ), cảnh báo (ledger lệch, minh chứng chờ duyệt quá SLA, job chết, KYC chờ), biểu đồ theo kỳ.
- DoD: số liệu khớp báo cáo; cảnh báo dẫn tới màn xử lý.

### [ ] F50 Admin: người dùng và KYC
- Màn: danh sách người dùng (lọc vai trò/trạng thái), chi tiết, duyệt KYC (xem CCCD + ảnh chân dung phóng to, so khớp bằng mắt theo checklist, cảnh báo CCCD/ảnh trùng, duyệt/từ chối/yêu cầu bổ sung + lý do), khóa/mở tài khoản, cấp/đổi vai trò, xem lịch sử đăng nhập.
- DoD: mọi thao tác ghi audit; xem giấy tờ có ghi log truy cập.

### [ ] F51 Admin: danh mục, nhà cung cấp, banner
- Màn: CRUD sản phẩm/danh mục/ảnh, duyệt sản phẩm NCC, quản lý NCC + tài khoản NCC (`supplier-accounts`), banner đối tác (hiệu lực, thứ tự).
- DoD: thay đổi hiển thị ngay ở trang công khai (sau cache).

### [ ] F52 Admin: lô mua hộ
- Màn: tạo/sửa lô (hàng, số lượng, giá vốn, chi phí, **tham số tỷ lệ theo lô**), **xem trước tính toán kinh tế**, xuất bản, theo dõi người tham gia, chốt đợt, chuyển bước 7 bước (kèm báo cáo/ảnh), phân hàng, hủy lô.
- DoD: đổi tham số cho kết quả xem trước khác nhau; thao tác chốt/hủy có xác nhận hai bước.

### [ ] F53 Admin: tiền
- Màn: **hàng đợi duyệt minh chứng** (ảnh phóng to cạnh yêu cầu, checklist đối chiếu, duyệt/duyệt một phần/từ chối), duyệt rút tiền/hoàn tiền/payout rồi **đánh dấu đã chuyển kèm ảnh minh chứng chi** (**duyệt hai lớp cho số tiền lớn**), tải sao kê ngân hàng và đối soát (danh sách dòng lệch, gán thủ công), xử lý giao dịch treo, xem sổ cái (chỉ đọc), kiểm tra bảo toàn.
- DoD: không có nút sửa/xóa bút toán; mọi duyệt hiển thị người duyệt và thời điểm.

### [ ] F54 Admin: khiếu nại, kho, điều phối, QC
- Màn: hàng đợi khiếu nại (đối chiếu hợp đồng bên cạnh), kho và điều chỉnh có duyệt, điều phối/chuyển hàng, QC, kiểm tra thực địa, hàng trả.
- DoD: mỗi hàng đợi có SLA/hạn xử lý hiển thị.

### [ ] F55 Admin: cấu hình hệ thống và audit
- Màn: tham số hệ thống (có mô tả, kiểm tra giá trị), mẫu thông báo, mẫu hợp đồng (phiên bản), xem audit log có lọc (người, hành động, đối tượng, khoảng thời gian), job nền.
- DoD: mọi thay đổi cấu hình hiển thị lịch sử.

### [ ] F56 Admin: báo cáo
- Màn: báo cáo tài chính/vận hành/sales, lọc kỳ, xuất Excel/PDF (job nền, tải khi xong).
- DoD: số liệu khớp backend.

## 6B.6 Chất lượng frontend

### [ ] F57 Form và validate
- Việc làm: schema Zod dùng chung với backend (`@cvc/shared`), thông báo lỗi tiếng Việt, lỗi theo trường, khóa nút khi gửi, cảnh báo rời trang khi form chưa lưu.
- DoD: mọi form quan trọng có test.

### [ ] F58 Hiệu năng
- Việc làm: code splitting theo route, lazy load ảnh, ảnh responsive (avif/webp + srcset), cache TanStack Query hợp lý, tránh render thừa trong danh sách dài (virtualize khi cần), bundle phân tích định kỳ.
- DoD: Lighthouse Performance ≥ 90 trang công khai (mobile), ≥ 80 trang ứng dụng.

### [ ] F59 Tối ưu bộ ảnh
- Việc làm: bộ ảnh demo ~59 MB → chuyển lên storage/CDN, nén, sinh nhiều kích thước, `loading="lazy"`; không đóng gói ảnh vào bundle.
- DoD: trang danh mục tải < 2 MB lần đầu.

### [ ] F60 Theo dõi lỗi và phân tích
- Việc làm: Sentry cho frontend (source map riêng tư), phân tích hành vi (GA/PostHog) **chỉ sau khi người dùng đồng ý cookie**, không gửi dữ liệu nhạy cảm.
- DoD: lỗi thật xuất hiện trong Sentry kèm requestId.

### [ ] F61 Cookie và quyền riêng tư
- Việc làm: banner đồng ý cookie (từng nhóm), trang quản lý quyền riêng tư (xuất dữ liệu cá nhân, yêu cầu xóa tài khoản), liên kết chính sách.
- DoD: không nạp công cụ phân tích trước khi đồng ý.

---

## DoD Phase 6B
- [ ] Mọi màn hình trong demo (22 màn) có tương đương thật chạy bằng API thật.
- [ ] E2E luồng chính xanh trên desktop và mobile.
- [ ] Không còn chữ "DEMO" ở giao diện; không còn số liệu giả.

---


# Phase 7 – Bảo mật và tuân thủ ⚠️ (S1 – S10)

Làm xen suốt dự án; siết lại và nghiệm thu trước Gate D.

### [ ] S1 Mã hóa dữ liệu nhạy cảm
- Việc làm: mã hóa tầng ứng dụng (AES-256-GCM) cho số CCCD, số tài khoản ngân hàng, kết quả eKYC thô; khóa trong env/KMS, hỗ trợ xoay khóa (có `keyId` trong bản ghi); chỉ hiển thị che (`****1234`); file giấy tờ lưu bucket riêng có mã hóa phía máy chủ.
- DoD: dump DB không đọc được giá trị nhạy cảm; test xoay khóa giữ đọc được bản cũ.

### [ ] S2 Kênh truyền và header
- Việc làm: HTTPS bắt buộc, HSTS, CSP chặt (không `unsafe-inline`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (camera chỉ cho trang POS), CORS theo danh sách domain, cookie `HttpOnly` + `Secure` + `SameSite`.
- DoD: quét header đạt điểm cao (securityheaders/Mozilla Observatory).

### [ ] S3 OWASP Top 10
- Việc làm: kiểm tra từng mục:
  - Injection (Prisma tham số hóa; cấm raw query nối chuỗi).
  - XSS (escape/sanitize chat, mô tả sản phẩm, ghi chú; không `dangerouslySetInnerHTML` với dữ liệu người dùng).
  - CSRF (nếu dùng cookie), SSRF (adapter gọi URL ngoài chỉ qua danh sách cho phép), IDOR (test ma trận ở P2.8).
  - Upload độc hại (kiểm MIME thật, quét virus, tên file an toàn).
  - Cấu hình sai (tắt Swagger/bull-board công khai ở production, ẩn stack trace).
  - Thành phần dễ tổn thương (S8).
- DoD: checklist OWASP có kết quả từng mục kèm bằng chứng test.

### [ ] S4 Chống lạm dụng
- Việc làm: rate limit nhiều tầng (IP, tài khoản, endpoint), CAPTCHA ở đăng ký/OTP/liên hệ, chống spam chat và tạo yêu cầu, khóa tạm khi hành vi bất thường, chặn quét danh mục công khai ồ ạt.
- DoD: thử tấn công thử nghiệm bị chặn.

### [ ] S5 Phát hiện gian lận
- Việc làm: quy tắc cảnh báo cho admin: ảnh minh chứng bị dùng lại hoặc nghi chỉnh sửa (trùng hash/gần trùng, metadata bất thường), minh chứng đã duyệt nhưng không có tiền về, nhiều tài khoản cùng thiết bị/CCCD/tài khoản ngân hàng, rút tiền ngay sau nạp, số tiền bất thường, thay đổi tài khoản ngân hàng gần thời điểm rút, đăng nhập từ nơi lạ; giới hạn rút theo ngày, độ trễ cho tài khoản mới (cooling-off).
- DoD: kịch bản gian lận mẫu kích hoạt cảnh báo.

### [ ] S6 Quản lý secret và quyền tối thiểu
- Việc làm: không secret trong repo (quét bằng gitleaks trong CI), secret production chỉ trên server/secret manager, xoay khóa định kỳ, DB user riêng cho ứng dụng (không dùng root; `LedgerEntry` chỉ INSERT/SELECT), bucket policy tối thiểu, tách khóa môi trường.
- DoD: gitleaks sạch; kiểm tra quyền DB/bucket theo checklist.

### [ ] S7 Dữ liệu cá nhân
- Việc làm: danh mục dữ liệu cá nhân đang thu và mục đích; thời hạn lưu; quy trình xuất/xóa dữ liệu theo yêu cầu (giữ lại dữ liệu bắt buộc theo luật như hóa đơn, giao dịch); quy trình thông báo khi lộ dữ liệu; hồ sơ đánh giá tác động xử lý dữ liệu cá nhân nếu luật yêu cầu (theo D9).
- DoD: tài liệu `docs/privacy.md` + chức năng xuất/xóa hoạt động.

### [ ] S8 Phụ thuộc
- Việc làm: `pnpm audit` trong CI, Dependabot/Renovate, cố định phiên bản (lockfile), cấm cài gói chưa rà soát cho module tiền; kiểm tra giấy phép.
- DoD: không còn lỗ hổng mức cao/nghiêm trọng chưa xử lý.

### [ ] S9 Kiểm thử xâm nhập
- Việc làm: tự rà theo checklist trước; sau đó pentest (thuê ngoài nếu có ngân sách) trước pilot, tập trung: xác thực, phân quyền, tiền, upload, webhook, chat; sửa hết lỗi cao/nghiêm trọng, kiểm tra lại.
- DoD: báo cáo pentest + bằng chứng đã sửa.

### [ ] S10 Tài liệu tuân thủ 🔒 D9
- Việc làm: điều khoản, chính sách bảo mật, quy chế, chính sách hoàn tiền/khiếu nại, cảnh báo rủi ro; đăng ký/thông báo website TMĐT với Bộ Công Thương (nếu thuộc diện); lưu bằng chứng đồng ý của người dùng (phiên bản, thời điểm, IP).
- DoD: luật sư duyệt; nội dung khớp tính năng thật.

---

## DoD Phase 7 (Gate D một phần)
- [ ] Checklist OWASP, secret, quyền DB/bucket đạt.
- [ ] Pentest xong, lỗi cao/nghiêm trọng đã sửa.
- [ ] Tài liệu tuân thủ được duyệt.

---


# Phase 8 – Kiểm thử (T1 – T11)

Mục tiêu: tự tin khi động vào tiền và hợp đồng. Chạy trong CI; E2E chạy hằng đêm và trước release.

### [ ] T1 Unit test
- Phạm vi: domain/service (máy trạng thái, công thức kinh tế, tính số hàng nguyên, hoàn 45 ngày + 3%, tính khoản hưởng bán giùm, validate).
- Việc làm: port 59 test của demo làm nền: `tests.mjs`, `buyer-tests.mjs`, `payment-cases-tests.mjs`, `participant-tests.mjs`, `sourcing-tests.mjs`, `vendor-tests.mjs`, `concierge-tests.mjs`; viết lại bằng Vitest/Jest, giữ nguyên **ý nghĩa** từng test, ghi chú nguồn.
- DoD: bảng đối chiếu "test demo → test mới" trong `docs/test-mapping.md`, không test demo nào bị bỏ sót.

### [ ] T2 Integration test
- Việc làm: API + MySQL/Redis thật trong container (Testcontainers hoặc Compose), mỗi test dùng schema/dữ liệu độc lập (transaction rollback hoặc DB tạm); phủ mọi module 4A–4D.
- DoD: toàn bộ endpoint có ít nhất test thành công + test phân quyền + test lỗi dữ liệu.

### [ ] T3 Test tiền
- Kịch bản bắt buộc:
  - Sổ cái luôn cân bằng sau mọi luồng (đặt cọc, thanh toán, hoàn, rút, hủy lô).
  - Ví không âm khi hai yêu cầu trừ tiền song song.
  - Idempotency: gọi lặp N lần (song song) chỉ tạo một giao dịch.
  - Minh chứng thanh toán: nộp trùng ảnh, ảnh sai số tiền, duyệt hai lần (idempotent), duyệt một phần, từ chối rồi nộp lại, quá hạn nộp, hai admin duyệt cùng lúc.
  - Race: hai người mua phần hạn mức cuối chỉ một thành công.
  - Chi thủ công: không ghi sổ cái hai lần, từ chối/hủy hoàn về ví đúng, đảo bút toán khi duyệt nhầm.
  - 45 ngày + 3%: phần hoàn một phần, đúng cơ sở tính.
- DoD: ngưỡng coverage module tiền ≥ 90% dòng/nhánh (CI chặn dưới ngưỡng).

### [ ] T4 Test máy trạng thái
- Việc làm: sinh test theo bảng chuyển trạng thái trong `packages/shared`: mọi cặp (từ, sang, vai trò) hợp lệ/không hợp lệ cho Order, Campaign, Claim, Sample, RFQ, Withdrawal, ReturnRequest.
- DoD: thêm trạng thái mới mà quên cập nhật test thì CI fail.

### [ ] T5 Test phân quyền
- Việc làm: ma trận 7 vai trò × endpoint (tự sinh từ metadata route); test IDOR cho mọi tài nguyên thuộc người dùng (đơn, phòng chat, hợp đồng, ví, file KYC, báo cáo); test 404 vs 403 đúng quy ước.
- DoD: route mới không khai báo quyền → test fail.

### [ ] T6 E2E (Playwright) luồng chính
- Kịch bản:
  1. Tìm nguồn trọn vòng (gửi yêu cầu → báo giá → chọn → chat/đề nghị giá → khóa điều khoản → mẫu → ký (mock) → cọc (nộp ảnh minh chứng, admin duyệt) → sản xuất → QC → thanh toán đuôi → vận chuyển → nhận → hoàn tất).
  2. Khiếu nại đủ nhánh (hoàn tiền, trả hàng, bù tiền).
  3. Mua hộ: đăng lô → hai người tham gia (tranh hạn mức) → ký/thanh toán → chốt đợt → 7 bước → phân hàng → bán → hoàn 45 ngày + 3%; và nhánh hủy lô thiếu ngưỡng.
  4. Bán giùm: đăng ký → ký → nhận hàng → bán (nhập tay + CSV) → chuyển hàng → kiểm đếm → đối soát → rút tiền.
  5. Rút tiền: yêu cầu → duyệt hai lớp → admin chuyển khoản và đánh dấu đã chi kèm ảnh minh chứng.
  6. KYC: nộp → duyệt/từ chối → mở quyền.
- DoD: toàn bộ kịch bản xanh trên Chromium; chạy hằng đêm trên staging.

### [ ] T7 E2E mobile
- Việc làm: chạy các kịch bản chính trên viewport điện thoại; riêng POS (camera giả lập), kiểm tra thực địa, ký hợp đồng, thanh toán QR.
- DoD: không lỗi bố cục/thao tác ở 360px.

### [ ] T8 Test tải
- Việc làm: k6/Artillery theo số người dùng dự kiến (đặt mục tiêu cùng sếp): danh mục công khai, đăng nhập, tham gia lô lúc mở bán (đột biến), chat realtime (số phòng/kết nối đồng thời), nộp và duyệt minh chứng đồng thời, job nền; đo p95, tỷ lệ lỗi, CPU/RAM/DB.
- DoD: đạt mục tiêu đã chốt; báo cáo `docs/load-test.md`; điểm nghẽn đã xử lý (index, cache, pool).

### [ ] T9 Test khi bên thứ 3 lỗi
- Việc làm: giả lập timeout, 5xx, phản hồi chậm, webhook đến trễ/trùng cho: chữ ký số/hợp đồng, SMS, email, hóa đơn điện tử, dịch; kiểm tra: không treo đơn, không mất/trùng tiền, người dùng nhận thông báo rõ, có đường xử lý thủ công.
- DoD: bảng "dịch vụ chết thì chuyện gì xảy ra" trong runbook (O10).

### [ ] T10 UAT
- Việc làm: kịch bản nghiệm thu theo từng vai trò viết bằng ngôn ngữ nghiệp vụ; sếp/đối tác chạy trên staging với dữ liệu giống thật; ghi lỗi (bảng: mô tả, mức độ, trạng thái); sửa và kiểm tra lại; ký nghiệm thu từng dịch vụ.
- DoD: không còn lỗi mức cao; biên bản nghiệm thu.

### [ ] T11 Ngưỡng chất lượng trong CI
- Việc làm: coverage tối thiểu theo module (tiền/hợp đồng/phân quyền ≥ 90%, còn lại ≥ 70%), lint/typecheck/test bắt buộc, E2E smoke trên mỗi PR vào `main`, báo cáo coverage.
- DoD: PR dưới ngưỡng bị chặn.

---

## DoD Phase 8
- [ ] Test demo đã port đủ, mapping rõ.
- [ ] Module tiền/hợp đồng/phân quyền đạt ngưỡng; E2E xanh; test tải đạt mục tiêu; UAT được ký.

---


# Phase 9 – DevOps và vận hành (O1 – O12)

### [ ] O1 Nghiệm thu Docker production
- Dockerfile, compose, build/nén image, migrate đã làm ở P1.11–P1.15; ở đây nghiệm thu: image build lặp lại, quét lỗ hổng, kích thước, chạy non-root, không chứa secret, cùng image chạy staging/production chỉ đổi env.
- DoD: bảng kích thước image mỗi bản; trivy không lỗ hổng nghiêm trọng; diễn tập `docker load` từ file nén trên máy chủ sạch thành công.

### [ ] O2 Hạ tầng production (chạy bằng Docker)
- Việc làm: cài Docker Engine + Compose plugin; toàn bộ dịch vụ chạy bằng `docker-compose.prod.yml`; **chỉ proxy publish 80/443**; firewall, SSH key-only, fail2ban; cập nhật bảo mật tự động cho host; Docker daemon `live-restore`; hạn chế nhóm `docker`; volume trên đĩa riêng hoặc có snapshot; xoay vòng log.
- DoD: quét cổng từ ngoài chỉ thấy cổng cần thiết; khởi động lại máy chủ thì toàn bộ container tự lên đúng.

### [ ] O3 CI/CD và deploy bằng image
- Việc làm: merge `main` → build image + push → deploy staging (`docker compose pull && up -d`); production deploy bằng tag + duyệt tay; `deploy.sh`: backup → nạp image (pull hoặc `docker load` từ file nén) → `migrate` → `up -d` → kiểm tra `/health` → **tự rollback nếu lỗi**; rollback = đặt lại `IMAGE_TAG` cũ + `up -d` (giữ N tag trước); thông báo kết quả deploy vào kênh chat.
- DoD: diễn tập deploy và rollback trên staging, thời gian rollback đo được.

### [ ] O4 Migration an toàn
- Việc làm: quy trình: backup trước migrate → thử migration trên bản sao dữ liệu staging → chạy production ngoài giờ cao điểm → kiểm tra sau; migration phá hủy (drop/đổi tên cột) tách làm nhiều bước tương thích ngược; **không** `migrate reset` trên production (chặn bằng cờ).
- DoD: tài liệu `docs/migrations.md`; diễn tập thành công.

### [ ] O5 Backup và khôi phục
- Việc làm: backup DB hằng ngày (cron trên host gọi `docker compose exec mysql mysqldump`, hoặc container backup riêng) + binlog (khôi phục theo thời điểm), bucket tệp riêng tư nhân bản/versioning, lưu **ngoài máy chủ chính** (nhà cung cấp khác), mã hóa, giữ theo lịch (ví dụ 7 ngày/4 tuần/6 tháng); **thử khôi phục định kỳ** vào môi trường riêng và kiểm tra tính toàn vẹn (sổ cái cân bằng sau khôi phục).
- DoD: biên bản khôi phục thử thành công kèm thời gian khôi phục (RTO) và dữ liệu mất tối đa (RPO).

### [ ] O6 Giám sát
- Việc làm: uptime (từ bên ngoài), tài nguyên máy chủ, MySQL (kết nối, truy vấn chậm), Redis, hàng đợi (độ dài, lỗi), tỷ lệ lỗi API, độ trễ, Sentry (api + web), log tập trung có tìm kiếm; dashboard.
- DoD: dashboard dùng được; mô phỏng sự cố hiện lên đúng.

### [ ] O7 Cảnh báo
- Việc làm: cảnh báo vào Telegram/Zalo/email khi: 5xx tăng, minh chứng chờ duyệt quá SLA, minh chứng đã duyệt nhưng không có tiền về, ảnh minh chứng trùng, **ledger lệch** (P4.25), job chết/dead-letter, đối soát có dòng lệch, hết dung lượng/RAM, chứng chỉ sắp hết hạn, chi phí SMS/AI vượt ngưỡng; phân mức (khẩn/thường), người trực.
- DoD: mỗi loại cảnh báo thử kích hoạt thành công.

### [ ] O8 Sẵn sàng và tắt êm
- Việc làm: `/health` (sống), `/ready` (DB/Redis/queue ok), graceful shutdown (xử lý nốt request/job), job định kỳ chạy một bản (khóa phân tán), triển khai không gián đoạn (rolling/blue-green nếu cần).
- DoD: deploy lúc có tải không mất request.

### [ ] O9 Quản lý log
- Việc làm: xoay vòng, giới hạn dung lượng, không log dữ liệu nhạy cảm (test), thời hạn lưu theo S7; log audit lưu lâu hơn.
- DoD: kiểm tra mẫu log không có CCCD/OTP/token.

### [ ] O10 Runbook
- Nội dung `docs/runbook.md`:
  - Thanh toán thủ công: minh chứng nghi giả, tiền về mà chưa có minh chứng, thừa/thiếu/sai nội dung/trùng, duyệt nhầm, chi nhầm, ledger lệch (các bước kiểm tra, ai quyết định, cách đảo bút toán).
  - Rollback deploy, khôi phục DB, khóa khẩn cấp tài khoản/rút tiền, bật/tắt chế độ bảo trì.
  - Docker: container restart liên tục (xem log, health), đầy đĩa do image/log, khôi phục từ file nén, vào MySQL/Redis/SeaweedFS trong container.
  - Bên thứ 3 chết: bảng dịch vụ → triệu chứng → xử lý tạm → liên hệ (xem T9).
  - Sự cố bảo mật/lộ dữ liệu: các bước, thông báo người dùng và cơ quan (theo S7/D9).
  - Danh sách người trực, kênh liên lạc, thang leo cấp.
- DoD: người ngoài nhóm làm theo được; đã diễn tập ít nhất 3 kịch bản.

### [ ] O11 Dung lượng và chi phí
- Việc làm: ước tính theo T8; bảng chi phí hằng tháng (hạ tầng, SMS/ZNS, email, AI dịch, chữ ký số/hợp đồng, eKYC, cổng thanh toán, hóa đơn điện tử); cảnh báo chi phí; kế hoạch nâng cấp khi vượt ngưỡng.
- DoD: `docs/cost.md` sếp duyệt.

### [ ] O12 Bàn giao
- Việc làm: tài liệu kiến trúc, cách build/nén/nạp image và deploy/rollback bằng Docker, biến môi trường, danh sách tài khoản bên thứ 3 và người sở hữu, quy trình vận hành hằng ngày (duyệt KYC, rút tiền, đối soát, khiếu nại), checklist đầu tháng (kiểm tra backup, chi phí, cập nhật phụ thuộc).
- DoD: một người khác dựng lại và vận hành được chỉ từ tài liệu.

### [ ] O13 Vận hành Docker
- Việc làm: giới hạn và xoay vòng log mỗi container; `restart: unless-stopped`; chính sách dọn dẹp **chỉ image/container cũ, không bao giờ `docker volume prune` trên production**; cập nhật base image hằng tháng + rebuild + quét; theo dõi dung lượng đĩa (image, volume, log); giám sát container (trạng thái, số lần restart, RAM/CPU) bằng cAdvisor hoặc tương đương; tài liệu lệnh thường dùng (`docker compose ps/logs/exec`).
- DoD: runbook có mục Docker; cảnh báo khi container restart liên tục hoặc đĩa > 80%.

---

## DoD Phase 9 (Gate D một phần)
- [ ] Diễn tập deploy, rollback, khôi phục backup đều thành công.
- [ ] Dựng lại toàn hệ thống từ file nén image + compose + `.env` trên máy chủ sạch.
- [ ] Giám sát + cảnh báo hoạt động; runbook đã diễn tập.

---


# Phase 10 – Dữ liệu thật và nội dung · Phase 11 – Ra mắt

## Phase 10 – Dữ liệu và nội dung (C1 – C8)

### [ ] C1 Dữ liệu thật
- Việc làm: thay dữ liệu mẫu (30 sản phẩm, 18 NCC, 20 cửa hàng trong `seed()`) bằng dữ liệu thật qua công cụ import (CSV/Excel) có xem trước và báo lỗi; seed production chỉ gồm: admin ban đầu, vai trò, cấu hình hệ thống, mẫu thông báo, mẫu hợp đồng, chính sách; seed dev/staging giữ riêng.
- DoD: import chạy được lặp lại (idempotent); không còn dữ liệu mẫu ở production.

### [ ] C2 Ảnh và mô tả sản phẩm
- Việc làm: ảnh/mô tả thật **có quyền sử dụng** (bộ ảnh demo lấy từ nguồn tham khảo như Alibaba, không dùng cho bản bán); chuẩn hóa kích thước, nén, đặt tên; kiểm tra bản quyền từng nguồn.
- DoD: danh sách nguồn ảnh + giấy phép/nguồn gốc cho từng sản phẩm.

### [ ] C3 Banner đối tác
- Việc làm: banner nhà cung cấp/vận chuyển thật (tên trong demo chỉ minh họa), có thỏa thuận cho phép hiển thị logo/tên; thời hạn hiển thị.
- DoD: mỗi banner có xác nhận bằng văn bản/email của đối tác.

### [ ] C4 Nội dung trang
- Việc làm: trang chủ, giới thiệu 3 dịch vụ, FAQ, điều khoản, chính sách, cảnh báo rủi ro — do sếp/pháp chế duyệt; nội dung không cam kết lợi nhuận, thống nhất thuật ngữ (Tìm nguồn hàng, Mua hộ, Bán giùm, Deal Room).
- DoD: biên bản duyệt nội dung.

### [ ] C5 Mẫu hợp đồng thật
- Việc làm: luật sư soạn/duyệt ba mẫu (Tìm nguồn, Mua hộ, Bán giùm); song ngữ nếu cần cho NCC nước ngoài; điều khoản 45 ngày/3%, khiếu nại, giải quyết tranh chấp; nạp vào hệ thống (P5.4) và thử render.
- DoD: bản ký thử sandbox hiển thị đúng.

### [ ] C6 Mẫu thông báo
- Việc làm: viết và đăng ký mẫu email/SMS/ZNS cho mọi sự kiện (OTP, KYC, báo giá, đề nghị giá, ký, thanh toán, vận chuyển, khiếu nại, đối soát, rút tiền, hoàn 45 ngày); duyệt template với nhà mạng/Zalo (mất thời gian — làm sớm).
- DoD: danh sách sự kiện ↔ mẫu ↔ trạng thái duyệt đầy đủ.

### [ ] C7 Hướng dẫn người dùng
- Việc làm: tài liệu/video ngắn theo vai trò (khách, mua hộ, bán giùm, NCC): đăng ký/KYC, từng luồng, thanh toán, ký, khiếu nại, rút tiền; trung tâm trợ giúp trên web.
- DoD: người mới làm theo được mà không cần hỏi.

### [ ] C8 Tài khoản ban đầu
- Việc làm: tạo admin (có 2FA), sales, kiểm tra viên, tài khoản NCC pilot; kiểm tra phân quyền từng tài khoản; không dùng mật khẩu mặc định; ghi người sở hữu từng tài khoản.
- DoD: danh sách tài khoản + người chịu trách nhiệm.

---

## Phase 11 – Ra mắt (L1 – L8)

### L1 Pháp lý hoàn tất (Gate E)
- [ ] D9 đã chốt, **luật sư xác nhận bằng văn bản**; ĐKKD/ngành nghề khớp; website/sàn TMĐT đã thông báo/đăng ký (nếu thuộc diện); điều khoản, chính sách, cảnh báo rủi ro đã đăng.

### L2 Tích hợp chạy môi trường thật
- [ ] Chữ ký số/hợp đồng, SMS/ZNS, email, hóa đơn điện tử, dịch dùng khóa production (không sandbox); webhook của hợp đồng đã đăng ký và kiểm tra chữ ký; tài khoản ngân hàng nhận tiền thật đã cấu hình và hiển thị đúng; đội duyệt minh chứng sẵn sàng.

### L3 Giao dịch thử tiền thật
- [ ] Thực hiện giao dịch thật số tiền nhỏ qua đủ luồng thủ công: nộp ảnh minh chứng → admin duyệt → ghi sổ cái; chi NCC/hoàn tiền/rút tiền (chuyển khoản tay + ảnh minh chứng chi); tham gia lô → hoàn; hóa đơn điện tử; đối soát sao kê khớp **100%** với sổ cái; ghi biên bản.

### L4 Pilot
- [ ] Mời nhóm nhỏ (vài NCC, vài bên mua hộ, vài cửa hàng, vài khách tìm nguồn); chạy 2–4 tuần; thu phản hồi và lỗi; sửa; có kênh hỗ trợ trực tiếp.

### L5 Đào tạo vận hành
- [ ] Đào tạo đội CVC: duyệt KYC, xử lý thanh toán lệch, khiếu nại, đối soát, duyệt rút tiền, hỏi đáp; tài liệu hướng dẫn nội bộ; diễn tập kịch bản trong runbook.

### L6 Kế hoạch hỗ trợ ngày đầu
- [ ] Người trực, kênh liên hệ, thời gian phản hồi cam kết; kịch bản sự cố (thanh toán lỗi, hệ thống chậm); thông báo trạng thái hệ thống.

### L7 Mở dần
- [ ] Mở theo nhóm/khu vực/hạn mức; theo dõi chỉ số: lỗi, giao dịch treo, thời gian duyệt KYC, tỷ lệ khiếu nại, hoàn tiền, độ lệch đối soát; ngưỡng dừng mở rộng nếu vượt.

### L8 Sau ra mắt 2 tuần
- [ ] Rà log, ledger, đối soát, phản hồi người dùng, chi phí thực tế (so với O11); lập backlog cải tiến; xem lại các mục "dời sang backlog".

---

## DoD Phase 10–11
- [ ] Không còn dữ liệu/nội dung mẫu ở production; mọi nội dung và hợp đồng được duyệt.
- [ ] Gate E đạt: luật sư xác nhận + giao dịch thử khớp 100%.

---
