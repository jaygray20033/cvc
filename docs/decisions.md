# CVC — Sổ quyết định nghiệp vụ / pháp lý (decisions log)

Nguồn sự thật cho các quyết định D1–D13. CLAUDE.md mục 5.6: gặp điểm mơ hồ về nghiệp vụ/tiền/pháp lý thì **dừng và hỏi**, ghi câu trả lời vào đây. Task 🔒 chỉ mở khi quyết định liên quan đã chốt.

Mẫu mỗi mục:
```
## D<n>. <Tên>
- Ngày chốt:
- Người chốt:
- Lựa chọn:
- Lý do:
- Ảnh hưởng tới task:
- Trạng thái: Đã chốt / Tạm / Chưa chốt
```

Tóm tắt nhanh: **D13 ĐÃ CHỐT** (vận hành thủ công + Docker). D1/D3 mới chốt *cách vận hành* (thủ công), còn chi tiết pháp lý/tài khoản chờ. D2, D4–D12 chưa chốt.

---

## D1. Vai trò của CVC trong giao dịch ⚠️
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: (a) CVC không chạm tiền (khách → NCC trực tiếp, CVC chỉ thu phí dịch vụ); hoặc (b) CVC nhận tiền vào tài khoản ngân hàng của CVC (hoặc bên được chỉ định), giữ theo sổ cái và **giải ngân thủ công** khi đủ điều kiện.
- Lý do: Mô hình mới nhất: CVC hỗ trợ tìm nguồn/khảo sát/giới thiệu, **không mua bán thay khách**. Cách vận hành tiền đã chốt thủ công ở D13; vai trò pháp lý (a hay b) cần xác nhận ở D9.
- Ảnh hưởng tới task: P4.19, P4.20, P4.23–P4.28, P5.9–P5.16, thiết kế ví/sổ cái.
- Trạng thái: **Chưa chốt** (chờ D9 cho phương án b).

## D2. Bên ký hợp đồng trong Tìm nguồn ⚠️
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: (a) khách ↔ NCC, CVC không ký; (b) CVC ký như trung gian/đại diện; (c) ba bên.
- Lý do: —
- Ảnh hưởng tới task: P5.1–P5.8 (chứng thư số công ty), mẫu hợp đồng C5.
- Trạng thái: **Chưa chốt**.

## D3. Luồng tiền ⚠️
- Ngày chốt: 2026-11-11 (phần cách vận hành, theo D13)
- Người chốt: Chủ dự án
- Lựa chọn: **Đã chốt cách vận hành (D13):** thanh toán và chi tiền **thủ công kiểu P2P** — người dùng chuyển khoản ngân hàng + **tải ảnh minh chứng**, admin tài chính đối chiếu sao kê và duyệt. Không cổng thanh toán, không webhook ngân hàng ở bản này.
- Còn phải chốt: tài khoản nhận tiền là của ai (CVC hay bên chỉ định theo D1); SLA duyệt; ngưỡng duyệt hai lớp; quy trình hoàn tiền/chi NCC thủ công; trách nhiệm khi duyệt nhầm/chuyển nhầm; pháp lý khi CVC nhận tiền hộ (D9).
- Ảnh hưởng tới task: P4.19, P4.20, P4.23–P4.28, P5.9–P5.16.
- Trạng thái: **Tạm** (cách vận hành đã chốt; chi tiết còn chờ).

## D4. Công thức kinh tế theo từng lô/sản phẩm
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: Tỷ lệ lợi nhuận/chia **thỏa thuận theo từng lô/sản phẩm**, không cố định. Tham số gợi ý trên `Campaign`/`CampaignLine`: `costPrice`, `retailPrice`, `participantShareRate`, `retailerShareRate`, `cvcFeeRate`, `logisticsCost`, `storageCost`, `otherCost`, `depositRate`. Cần chốt: giá vốn gồm gì, làm tròn, VND hay CNY.
- Lý do: Demo gán cứng 20% / 10% / 10% → **bỏ**.
- Ảnh hưởng tới task: P4.30, F52.
- Trạng thái: **Chưa chốt**.

## D5. Quy tắc hoàn 45 ngày + 3% ⚠️
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: 3% **chỉ tính trên giá trị hàng được hoàn** (đã chốt trong mô tả). Còn phải chốt: "hàng đủ điều kiện" là gì (chưa bán/còn nguyên/không hỏng); hoàn toàn bộ hay một phần; nguồn tiền chi 3%; điều kiện theo từng chương trình hay chung; mốc 45 ngày tính từ đâu (nhập kho/nhận hàng/chốt đợt).
- Lý do: —
- Ảnh hưởng tới task: P4.36, F36.
- Trạng thái: **Chưa chốt**.

## D6. Tiền tệ và tỷ giá
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: VND, CNY hay cả hai; nguồn tỷ giá; chốt lúc đặt cọc hay thanh toán. Theo D13, tỷ giá **nhập tay có duyệt** (`ExchangeRate` ghi ai nhập, khi nào — P5.14).
- Lý do: Demo hiển thị giá vốn/hỗ trợ vốn bằng CNY.
- Ảnh hưởng tới task: schema tiền (cột `currency`), P5.14.
- Trạng thái: **Chưa chốt**.

## D7. Thống nhất quy trình đơn Tìm nguồn
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: Đề xuất mặc định — lưu **10 trạng thái nội bộ** (có QC riêng), hiển thị khách **8 giai đoạn** (gộp Sản xuất + QC thành "Chờ hàng hoàn tất"; Vận chuyển đi cùng giai đoạn trước nhận hàng). Demo có 2 bản lệch: `orderSteps` (10) và `stages` (8).
- Lý do: Chính xác để vận hành nhưng gọn cho khách.
- Ảnh hưởng tới task: P4.16, F23.
- Trạng thái: **Chưa chốt** (đề xuất mặc định, chờ sếp xác nhận).

## D8. Chính sách khiếu nại/tranh chấp
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: Cần chốt thời hạn khiếu nại; phương án (hoàn tiền/đổi hàng/trả hàng/bù tiền); ai quyết định; CVC "hỗ trợ trao đổi và đối chiếu hợp đồng" cụ thể làm gì; chi phí trả hàng ai chịu.
- Lý do: —
- Ảnh hưởng tới task: P4.22, F28.
- Trạng thái: **Chưa chốt**.

## D9. Pháp lý ⚠️
- Ngày chốt: —
- Người chốt: — (cần luật sư/kế toán)
- Lựa chọn: Việc cần làm: (1) mô hình Mua hộ (góp tiền, chia lợi nhuận, hoàn + 3%) có bị xem là huy động vốn/đầu tư tài chính; (2) ngành nghề ĐKKD có khớp; (3) thông báo/đăng ký website/sàn TMĐT với Bộ Công Thương; (4) nghĩa vụ bảo vệ dữ liệu cá nhân (CCCD, tài khoản ngân hàng); (5) giá trị pháp lý hợp đồng điện tử/chữ ký số với bên nước ngoài; (6) thuế và hóa đơn phí dịch vụ. Đặc biệt: **CVC nhận tiền hộ (D1b) có hợp pháp không**.
- Đầu ra: văn bản xác nhận; nội dung điều khoản, chính sách, cảnh báo rủi ro.
- Ảnh hưởng tới task: Gate C, Gate E, F15–F16, C4–C5.
- Trạng thái: **Chưa chốt** (chờ luật sư).

## D10. Hỗ trợ tiếp cận vốn (`funding`)
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: Giữ hay bỏ. Nếu giữ: đối tác ngân hàng/tổ chức nào; CVC chỉ chuyển hồ sơ hay có thẩm định.
- Lý do: Demo ghi rõ CVC **không phải tổ chức cấp tín dụng**.
- Ảnh hưởng tới task: P4.50, F29.
- Trạng thái: **Chưa chốt**.

## D11. Danh sách bên thứ 3 chọn dùng
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: Còn tích hợp — hợp đồng điện tử/chữ ký số (Viettel vContract/MySign?), SMS/OTP/ZNS, email, hóa đơn điện tử, dịch, hosting, lưu file. **Không còn tích hợp (D13):** cổng thanh toán, eKYC tự động, API hãng vận chuyển.
- Lý do: D13 chốt làm thủ công các mục trên; tích hợp tự động dời Backlog, giữ lớp adapter để cắm sau.
- Ảnh hưởng tới task: các task tích hợp còn lại ở Phase 5.
- Trạng thái: **Chưa chốt** (phần còn tích hợp).

## D12. Phạm vi nội dung thật
- Ngày chốt: —
- Người chốt: —
- Lựa chọn: Ai cung cấp danh mục sản phẩm thật, ảnh có bản quyền, danh sách NCC thật, banner đối tác thật, nội dung trang chủ/FAQ/điều khoản.
- Lý do: Ảnh/nội dung demo chỉ minh họa, chưa có bản quyền.
- Ảnh hưởng tới task: C1–C8, F13–F18.
- Trạng thái: **Chưa chốt**.

## D13. Vận hành thủ công và Docker ✅
- Ngày chốt: 2026-11-11
- Người chốt: Chủ dự án
- Lựa chọn:
  1. **Thanh toán/chi tiền thủ công kiểu P2P**: người dùng chuyển khoản + **tải ảnh minh chứng**; admin tài chính đối chiếu sao kê và duyệt. Chi tiền (NCC, hoàn tiền, rút tiền): admin chuyển khoản ngoài hệ thống rồi tải ảnh minh chứng chi. **Chỉ ghi sổ cái khi duyệt**, duyệt idempotent; chống dùng lại ảnh (hash) và mã giao dịch trùng. Không cổng thanh toán, không webhook ngân hàng.
  2. **eKYC duyệt tay**: ảnh CCCD mặt trước/sau + ảnh chân dung cầm CCCD. Không tích hợp eKYC tự động.
  3. **Vận chuyển tự đặt hãng ngoài**: NCC/CVC/khách tự đặt hãng; hệ thống lưu hãng, mã vận đơn, link tra cứu, ảnh phiếu và **mốc nhập tay**. Không tích hợp API hãng.
  4. **Toàn bộ hệ thống chạy bằng Docker** (dev + production); máy dev chỉ cần Docker + Git. Deploy bằng image build sẵn hoặc file nén `.tar.gz` (kèm SHA-256) hoặc registry riêng.
- Lý do: Chủ dự án chọn vận hành thủ công kiểu P2P (như dự án P2P của mình) và chạy tất cả bằng Docker cho nhất quán; tích hợp tự động (cổng/VA/webhook, OCR minh chứng, eKYC, API hãng) dời Backlog, giữ lớp adapter để cắm sau.
- Ảnh hưởng tới task: P1.3, P1.11–P1.15, P2.14, P4.17, P4.19, P4.20, P4.26, P4.27, P5.9–P5.17, P5.21, F26, F27, S5, T3, T6, O1–O3, O13.
- Trạng thái: **Đã chốt**.