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

| Nhóm                  | Thực thể chính                                                                                                                     | Ghi chú                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Người dùng & xác minh | `User`, `VerificationToken`, `Session`, `OtpRequest`, `RecoveryCode`, `UserRole`                                                   | argon2id; token/OTP lưu băm SHA-256; OTP qua Gmail (không SMS, 2026-11-13); TOTP 2FA — secret mã hóa AES-256-GCM (2026-11-14); `user_roles` = nguồn thật RBAC, 7 vai trò + nhóm `admin_*` (2026-11-14); eKYC duyệt tay (D13) |
| Tìm nguồn             | `SourcingRequest`, `DealRoom`, `DealMessage`, `Supplier`, `Quote`, `Rfq`, `Sample`, `SampleStop`                                   | Không lộ giá mua/NCC ngoài Deal Room                                                                                                                                                                                         |
| Mua hộ                | `Campaign`, `CampaignLot`, `Participation`, `Inventory`, `ReturnProgram`                                                           | Hoàn 45 ngày + 3% trên giá trị hàng được hoàn                                                                                                                                                                                |
| Bán giùm              | `Consignment`, `ConsignmentItem`, `Retailer`, `Settlement`                                                                         | Đối soát doanh thu/khoản được hưởng                                                                                                                                                                                          |
| Hợp đồng              | `Contract`, `ContractTemplate`, `ContractSignature`                                                                                | Bên ký/luồng tiền chờ D1/D3                                                                                                                                                                                                  |
| Thanh toán (thủ công) | `ReceivingAccount`, `Payment`, `PaymentProof`, `Payout`, `PayoutProof`, `BankStatementImport`, `BankStatementLine`, `ExchangeRate` | P2P + ảnh minh chứng, duyệt 2 lớp trên ngưỡng (D13)                                                                                                                                                                          |
| Sổ cái & ví           | `LedgerEntry`, `Wallet`, `WalletTransaction`                                                                                       | Cân bằng nợ/có, idempotent                                                                                                                                                                                                   |
| Vận chuyển (thủ công) | `Shipment`, `ShipmentStop`                                                                                                         | Hãng/mã vận đơn/link tra cứu + mốc nhập tay (D13)                                                                                                                                                                            |
| Khiếu nại             | `Claim`, `ClaimEvent`                                                                                                              | Máy trạng thái tường minh                                                                                                                                                                                                    |
| Hệ thống              | `AuditLog`, `Notification`, `Invoice`, `FileObject`, `IdempotencyKey`                                                              | File riêng tư (KYC, minh chứng) tách bucket công khai                                                                                                                                                                        |

## Quan hệ chính (phác thảo)

```
User 1─n VerificationToken (EMAIL_VERIFY | PASSWORD_RESET, token băm, một lần, có hạn)
User 1─n Session (refresh token băm; familyId = chuỗi xoay vòng, dùng lại token cũ → thu hồi cả chuỗi; activeRole = vai trò đang dùng, P2.9)
User 1─n UserRole (RBAC: 7 vai trò buyer/participant/retailer/supplier/sales/inspector/admin; nhóm admin thêm dạng admin_super/admin_finance/admin_ops/admin_support — P2.7/P2.9/P2.10)
OtpRequest (theo email; mã 6 số băm, hạn 5 phút, đếm số lần thử) — OTP đăng nhập qua Gmail, không phải SMS
User 1─n RecoveryCode (mã dự phòng 2FA, băm SHA-256, dùng đúng một lần; User.totpSecret mã hóa AES-256-GCM + totpEnabledAt; admin/sales/inspector bắt buộc bật 2FA)
User 1─n Participation n─1 CampaignLot n─1 Campaign
User 1─n ConsignmentItem n─1 Consignment
DealRoom 1─n DealMessage / Quote / Sample
Payment 1─n PaymentProof      Payout 1─n PayoutProof
LedgerEntry n─1 Wallet        Shipment 1─n ShipmentStop
```

> Sơ đồ chi tiết (cột, khóa ngoại, chỉ mục) sẽ bổ sung khi từng module được port từ demo sang Prisma.
