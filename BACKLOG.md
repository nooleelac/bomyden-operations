# BACKLOG — Việc đã hẹn làm sau

> Cuối mỗi phase, kiểm tra danh sách này và nhắc những việc đã đến hạn.
> Cập nhật trạng thái khi làm xong (✅) hoặc khi đổi kế hoạch.

| # | Việc | Ưu tiên | Làm khi nào | Cần quyết định | Trạng thái |
|---|---|---|---|---|---|
| 1 | **Tự dọn ảnh checklist cũ** (xóa ảnh trong kho `task-photos` cũ hơn 3 tháng, giữ dòng lịch sử trong DB) | Cao | Trước khi dùng thật | — (đã chốt: 3 tháng, áp dụng cho mọi ảnh) | ✅ Xong (08/10/2026) |
| 2 | **Thông báo việc sắp quá hạn / quá hạn** cho nhân viên phụ trách và quản lý | Trung bình | Cùng đợt deploy | — (đã chốt: Web Push trên app, báo trước 30 phút) | ✅ Xong (08/10/2026) — thử trên điện thoại thật sau khi deploy HTTPS |
| 7 | **Deploy lên hosting HTTPS** (Vercel hoặc tương tự) + thêm biến môi trường (gồm `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) + thử thông báo trên điện thoại thật | Cao | Bước tiếp theo | Chọn hosting / tên miền | ✅ Xong (09/10/2026) — đã deploy Vercel, thông báo chạy trên iPhone; tên miền chính: https://chamcong.bomyden.vn |
| 6 | **Thông báo qua Zalo OA** (kênh thứ hai) | Thấp | Khi cần | Có tài khoản Zalo OA không? | ⏳ Chưa làm |
| 3 | **Bảng tính lương** (dựa trên chấm công) | Cao | Phase 4 | — | ✅ Xong (08/10/2026) |
| 5 | **Nghỉ có phép trong bảng lương** (nối module Lịch làm việc / xin nghỉ với bảng lương) | Trung bình | Phase 5 | — (đã chốt: QTV đánh dấu có lương, 1 ngày nghỉ = 1 ngày công lương cố định) | ✅ Xong (08/10/2026) |
| 4 | **Bật "Leaked password protection"** trong Supabase Auth | Thấp | Khi nâng gói Supabase (có thể chỉ có ở gói trả phí) | — | ⏳ Chưa làm |
| 8 | **Cài khóa AI + thử nhập kho thật**: tạo `ANTHROPIC_API_KEY` (console.anthropic.com, nạp ≥ 5 USD), thêm vào `.env.local` + Vercel, deploy, chụp 3–5 hóa đơn thật (in + viết tay) trên điện thoại | Cao | Ngay sau Phase 6 | Haiku 5.5 đọc phiếu viết tay có đủ tốt không? Nếu sai nhiều → `INVOICE_AI_MODEL=claude-sonnet-5-5` | ✅ Xong (09/10/2026) — 9 lượt quét bằng Haiku 5.5, 2 phiếu đã lưu; 2 lỗi đầu là trước bản sửa schema |
| 9 | **Xuất kho / kiểm kê** (trừ tồn theo hàng dùng, phiếu kiểm kê định kỳ, cảnh báo tồn thấp) | Trung bình | Phase sau | Xuất theo ca/ngày hay theo món bán? | ✅ Xong (10/10/2026) — kiểm kê suy ra lượng dùng, phiếu xuất (hủy / chuyển chi nhánh / khác), báo cáo tiêu hao, mức tối thiểu + thông báo 9:00 |
| 10 | **Công nợ nhà cung cấp** (đã trả / chưa trả, số nợ từng NCC) | Thấp | Khi cần | — (đã chốt: đầy đủ, QTV + QL ghi thanh toán) | ✅ Xong (09/10/2026) — kèm VAT theo từng dòng, giá vốn sau VAT |
| 12 | **Thông báo đăng ký ca**: báo QL khi NV gửi đăng ký mới; báo NV khi được duyệt / từ chối; nhắc NV part-time chưa đăng ký tuần tới | Trung bình | Khi dùng thật tính năng tự đăng ký | Nhắc vào thứ mấy, mấy giờ? | ✅ Xong (10/10/2026) — báo QL khi NV gửi đăng ký / đơn, báo NV khi duyệt / từ chối, nhắc NV chưa đăng ký tuần tới vào T7 15:00 (hạn chót 2 ngày) |
| 11 | **Nhắc công nợ sắp đến hạn / quá hạn** qua thông báo đẩy cho QTV/QL | Thấp | Khi cần | Báo trước mấy ngày? | ⏳ Chưa làm |

## Ghi chú ước tính dung lượng ảnh

- Ảnh sau khi thu nhỏ ≈ 350 KB. 20 ảnh/ngày ≈ 7 MB/ngày ≈ 210 MB/tháng (1 chi nhánh).
- Gói Free Supabase: 1 GB lưu file → đầy sau khoảng 4–5 tháng nếu không dọn.
- Ảnh hóa đơn (≤2000px) ≈ 500 KB, giữ 12 tháng. 5 hóa đơn/ngày ≈ 75 MB/tháng ≈ 900 MB/năm → cộng với ảnh checklist sẽ vượt
  1 GB gói Free; khi dùng thật nhiều nên nâng gói Supabase Pro (100 GB) hoặc rút thời gian giữ ảnh hóa đơn.
