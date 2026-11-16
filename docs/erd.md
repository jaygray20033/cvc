# CVC – ERD (khung)

Đây là khung dữ liệu. Mô hình chi tiết + migration được hiện thực từ Phase 2 trở đi; cập nhật file này khi thêm bảng.

## Quy ước chung

- Bảng số nhiều **snake_case** qua `@@map`; cột **camelCase** trong code qua `@map`.
- Khóa chính `id` (cuid/uuid). Thời gian `createdAt`, `updatedAt` (DateTime).
- **Tiền:** kiểu `Decimal`, luôn kèm cột `currency` (`VND`/`CNY`). Không dùng float.
- **Sổ cái kép:** `LedgerEntry` bất biến (không sửa/xóa; sai thì bút toán đảo). Mỗi giao dịch cân bằng nợ/có.
- Máy trạng thái lưu cột `status` + bảng sự kiện (`OrderEvent`, audit) ghi ai/khi nào/từ→sang/lý do.
- Phân quyền theo 7 vai trò; kiểm tra sở hữu bản ghi ở tầng service.

## Nhóm thực thể (dự kiến)

| Nhóm                  | Thực thể chính                                                                                                                                                    | Ghi chú                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Người dùng & xác minh | `User`, `VerificationToken`, `Session`, `OtpRequest`, `RecoveryCode`, `UserRole`, `Profile`, `Address`, `BankAccount`, `KycSubmission`, `KycDocument`, `KycEvent` | argon2id; token/OTP lưu băm SHA-256; OTP qua Gmail (không SMS, 2026-11-13); TOTP 2FA — secret mã hóa AES-256-GCM (2026-11-14); `user_roles` = nguồn thật RBAC, 7 vai trò + nhóm `admin_*` (2026-11-14); hồ sơ cá nhân/hộ KD/doanh nghiệp, số TK ngân hàng mã hóa AES-256-GCM + hiển thị che `****1234` (2026-11-14); eKYC duyệt tay (D13) |
| Tìm nguồn             | `SourcingRequest`, `DealRoom`, `DealMessage`, `Supplier`, `Quote`, `Rfq`, `Sample`, `SampleStop`                                                                  | Không lộ giá mua/NCC ngoài Deal Room                                                                                                                                                                                                                                                                                                      |
| Mua hộ                | `Campaign`, `CampaignLot`, `Participation`, `Inventory`, `ReturnProgram`                                                                                          | Hoàn 45 ngày + 3% trên giá trị hàng được hoàn                                                                                                                                                                                                                                                                                             |
| Bán giùm              | `Consignment`, `ConsignmentItem`, `Retailer`, `Settlement`                                                                                                        | Đối soát doanh thu/khoản được hưởng                                                                                                                                                                                                                                                                                                       |
| Hợp đồng              | `Contract`, `ContractTemplate`, `ContractSignature`                                                                                                               | Bên ký/luồng tiền chờ D1/D3                                                                                                                                                                                                                                                                                                               |
| Thanh toán (thủ công) | `ReceivingAccount`, `Payment`, `PaymentProof`, `Payout`, `PayoutProof`, `BankStatementImport`, `BankStatementLine`, `ExchangeRate`                                | P2P + ảnh minh chứng, duyệt 2 lớp trên ngưỡng (D13)                                                                                                                                                                                                                                                                                       |
| Sổ cái & ví           | `LedgerEntry`, `Wallet`, `WalletTransaction`                                                                                                                      | Cân bằng nợ/có, idempotent                                                                                                                                                                                                                                                                                                                |
| Vận chuyển (thủ công) | `Shipment`, `ShipmentStop`                                                                                                                                        | Hãng/mã vận đơn/link tra cứu + mốc nhập tay (D13)                                                                                                                                                                                                                                                                                         |
| Khiếu nại             | `Claim`, `ClaimEvent`                                                                                                                                             | Máy trạng thái tường minh                                                                                                                                                                                                                                                                                                                 |
| Hệ thống              | `AuditLog`, `Notification`, `NotificationPreference`, `Invoice`, `FileObject`, `IdempotencyKey`, `SystemSetting`, `SearchDocument`                                | File riêng tư (KYC, minh chứng) tách bucket công khai; AuditLog append-only + hash chuỗi, Notification theo kênh + preference (2026-11-15); IdempotencyKey thêm `expiresAt` TTL 24h (2026-11-16); SystemSetting cấu hình runtime có version + audit; SearchDocument chỉ mục FULLTEXT dùng chung (2026-11-16)                              |

## Quan hệ chính (phác thảo)

```
User 1─n VerificationToken (EMAIL_VERIFY | PASSWORD_RESET, token băm, một lần, có hạn)
User 1─n Session (refresh token băm; familyId = chuỗi xoay vòng, dùng lại token cũ → thu hồi cả chuỗi; activeRole = vai trò đang dùng, P2.9)
User 1─n UserRole (RBAC: 7 vai trò buyer/participant/retailer/supplier/sales/inspector/admin; nhóm admin thêm dạng admin_super/admin_finance/admin_ops/admin_support — P2.7/P2.9/P2.10)
OtpRequest (theo email; mã 6 số băm, hạn 5 phút, đếm số lần thử) — OTP đăng nhập qua Gmail, không phải SMS
User 1─n RecoveryCode (mã dự phòng 2FA, băm SHA-256, dùng đúng một lần; User.totpSecret mã hóa AES-256-GCM + totpEnabledAt; admin/sales/inspector bắt buộc bật 2FA)
User 1─1 Profile (orgType PERSONAL/BUSINESS_HOUSEHOLD/COMPANY; displayName; MST unique, ĐKKD, người đại diện — P2.11)
User 1─n Address (label, người nhận, SĐT, city/district/ward/line, isDefault — P2.11)
User 1─n BankAccount (bankName, holderName phải khớp tên hồ sơ; accountNoEnc mã hóa AES-256-GCM + accountNoLast4 hiển thị + accountNoHash SHA-256 unique — P2.11)
User 1─n KycSubmission (status PENDING/NEED_MORE/APPROVED/REJECTED; reviewedBy/reviewedAt/reviewNote) 1─n KycDocument (type CCCD_FRONT/CCCD_BACK/BUSINESS_REG/AUTHORIZATION; mime/size/s3Key/bucket — file nằm bucket riêng tư, chỉ chủ sở hữu + admin KYC tải link có hạn 5 phút, log truy cập) — P2.12
KycSubmission 1─n KycEvent (SUBMITTED/DOCUMENT_UPLOADED/APPROVED/NEED_MORE/REJECTED/DOCUMENT_ACCESSED — lịch sử duyệt + log truy cập, P2.13)
AuditLog (append-only, không update/delete API; hash chuỗi SHA-256 mỗi dòng chứa hash dòng trước — verifyChain phát hiện can thiệp; AuditInterceptor tự log mọi write + log tay cho phân quyền/KYC/file; GET /admin/audit-logs + /verify chỉ admin) — P2.16
FileObject (ownerType/ownerId tham chiếu lỏng không FK; purpose kyc/payment_proof/shipping_proof/general; declaredMime + detectedMime magic bytes; status UPLOADING/READY/REJECTED; scanStatus NOT_SCANNED/PENDING/CLEAN/INFECTED/ERROR — chưa CLEAN không cho tải; presigned PUT/GET bucket riêng tư; thumbnail WebP 320px) — P2.17
User 1─n Notification (event, title, body, data, readAt) 1─1 NotificationPreference (email/inApp/sms/zns/push; event bắt buộc bảo mật/tiền bỏ qua opt-out) — P2.18
IdempotencyKey (key = sha256(path|Idempotency-Key header), scope, requestHash, response {status, body}, expiresAt = createdAt + 24h; interceptor toàn cục cho POST có header; cùng key khác body → 422, lặp → trả lại kết quả đã lưu, lỗi → xóa slot; index expiresAt) — P2.21
SystemSetting (key VarChar(100) PK, value Json, version tăng khi ghi, updatedById; registry zod từng khóa, cache Redis TTL 30s tự hủy khi ghi; lịch sử đọc từ AuditLog entityType system_setting) — P2.22
SearchDocument (entityType + entityId unique, title, searchText chuẩn hóa bỏ dấu/đ→d + FULLTEXT ngram index thêm bằng raw SQL, data Json, status published/unpublished; các module domain tự upsert/remove khi bảng của chúng ra đời P3+) — P2.23
User 1─n Participation n─1 CampaignLot n─1 Campaign
User 1─n ConsignmentItem n─1 Consignment
DealRoom 1─n DealMessage / Quote / Sample
Payment 1─n PaymentProof      Payout 1─n PayoutProof
LedgerEntry n─1 Wallet        Shipment 1─n ShipmentStop
```

> Sơ đồ chi tiết (cột, khóa ngoại, chỉ mục) sẽ bổ sung khi từng module được port từ demo sang Prisma.
