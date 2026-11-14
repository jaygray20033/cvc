# Ma trận phân quyền (P2.7 / P2.8 / P2.9 / P2.10)

> Cập nhật khi thêm module mới. Mọi route **phải** khai báo `@Public()` hoặc
> `@Roles(...)` — test `route-declaration.spec.ts` quét toàn bộ route và fail
> build nếu thiếu (mặc định từ chối). Kiểm tra sở hữu bản ghi (P2.8) làm ở tầng
> service bằng `assertOwned(actorId, ownerId, resource)` — trả 404, không trả 403
> để không lộ sự tồn tại của bản ghi.

## Vai trò (7, từ `domain.js`)

`buyer` (khách tìm nguồn) · `participant` (bên mua hộ) · `retailer` (bên bán giùm) ·
`supplier` (NCC) · `sales` (kinh doanh CVC) · `inspector` (kiểm tra CVC) · `admin` (quản trị).

- Vai trò lưu bảng `user_roles` (một user nhiều vai trò, P2.9). Đăng ký mặc định `buyer`.
- Access token chứa `role` = **vai trò đang dùng** của phiên (`sessions.activeRole`).
  `RolesGuard` so khớp `role` trong token với `@Roles(...)` của route.
- Chuyển vai trò: `POST /me/active-role` → cấp access token mới, không cần đăng nhập lại, ghi audit log.
- `admin/sales/inspector` **bắt buộc bật 2FA** (P2.5) trước khi đăng nhập bằng mật khẩu.

## Ma trận hiện tại (module auth + me)

| Nhóm endpoint                                                                                                                                                   | buyer                   | participant | retailer  | supplier  | sales     | inspector | admin     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------- | --------- | --------- | --------- | --------- | --------- |
| `POST /auth/register`, `/auth/verify-email`, `/auth/login`, `/auth/otp/*`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/refresh`, `/auth/2fa/verify` | public                  | public      | public    | public    | public    | public    | public    |
| `GET /health`, `GET /ready`                                                                                                                                     | public                  | public      | public    | public    | public    | public    | public    |
| `POST /auth/change-password`, `/auth/logout`, `/auth/2fa/setup                                                                                                  | enable                  | disable`    | ✅        | ✅        | ✅        | ✅        | ✅        | ✅  | ✅  |
| `GET /auth/sessions`, `DELETE /auth/sessions/:id`                                                                                                               | ✅ (chỉ phiên của mình) | ✅ (mình)   | ✅ (mình) | ✅ (mình) | ✅ (mình) | ✅ (mình) | ✅ (mình) |
| `GET /me`, `POST /me/active-role`                                                                                                                               | ✅                      | ✅          | ✅        | ✅        | ✅        | ✅        | ✅        |

## Module sau (điền khi hiện thực — P3+)

| Nhóm endpoint                | buyer | participant | retailer | supplier | sales | inspector | admin |
| ---------------------------- | ----- | ----------- | -------- | -------- | ----- | --------- | ----- |
| Sourcing request / Deal Room | TBD   | TBD         | TBD      | TBD      | TBD   | TBD       | TBD   |
| Campaign (mua hộ)            | TBD   | TBD         | TBD      | –        | TBD   | TBD       | TBD   |
| Consignment (bán giùm)       | –     | TBD         | TBD      | –        | TBD   | TBD       | TBD   |
| Orders                       | TBD   | TBD         | TBD      | TBD      | TBD   | TBD       | TBD   |
| Admin                        | –     | –           | –        | –        | –     | –         | TBD   |

## Nhóm quyền admin (P2.10)

Admin có thể có thêm 1..n nhóm quyền, lưu trong `user_roles` dạng `admin_*`
(chỉ cấp cho user đã có vai trò `admin`); check trong guard đọc DB trực tiếp
nên thu hồi có hiệu lực ngay. Dùng `@AdminGroups(...)` trên route.

| Nhóm            | Quyền                                                        |
| --------------- | ------------------------------------------------------------ |
| `admin_super`   | Toàn bộ, gồm cấu hình hệ thống (duy nhất nhóm được cấu hình) |
| `admin_finance` | Duyệt/rút/đối soát tiền (riêng với ops/support)              |
| `admin_ops`     | Vận hành: duyệt KYC, duyệt lô, vận chuyển, khiếu nại         |
| `admin_support` | Hỗ trợ khách hàng, xem hồ sơ                                 |

Quyền **rút/duyệt tiền**: `admin_finance` hoặc `admin_super`.
Quyền **cấu hình hệ thống**: chỉ `admin_super`.

## Việc còn lại

- Các module P3+ tự khai báo `@Roles()` theo ma trận trên; test quét route chặn nếu thiếu.
- Mỗi module có bản ghi riêng (order, campaign...) thêm test truy cập chéo IDOR (P2.8)
  và dùng `assertOwned`; test IDOR viết cùng module.
- P2.16: đổi audit log pino hiện tại của `POST /me/active-role` sang bảng `AuditLog`.
