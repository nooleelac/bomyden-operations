# BACKLOG — Việc đã hẹn làm sau

> Cuối mỗi phase, kiểm tra danh sách này và nhắc những việc đã đến hạn.
> Cập nhật trạng thái khi làm xong (✅) hoặc khi đổi kế hoạch.

| # | Việc | Ưu tiên | Làm khi nào | Cần quyết định | Trạng thái |
|---|---|---|---|---|---|
| 1 | **Tự dọn ảnh checklist cũ** (xóa ảnh trong kho `task-photos` cũ hơn 3 tháng, giữ dòng lịch sử trong DB) | Cao | Trước khi dùng thật | — (đã chốt: 3 tháng, áp dụng cho mọi ảnh) | ✅ Xong (08/10/2026) |
| 2 | **Thông báo việc sắp quá hạn / quá hạn** cho nhân viên phụ trách và quản lý | Trung bình | Cùng đợt deploy | — (đã chốt: Web Push trên app, báo trước 30 phút) | ✅ Xong (08/10/2026) — thử trên điện thoại thật sau khi deploy HTTPS |
| 7 | **Deploy lên hosting HTTPS** (Vercel hoặc tương tự) + thêm biến môi trường (gồm `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) + thử thông báo trên điện thoại thật | Cao | Bước tiếp theo | Chọn hosting / tên miền | ✅ Xong (09/10/2026) — đã deploy Vercel, thông báo chạy trên iPhone |
| 6 | **Thông báo qua Zalo OA** (kênh thứ hai) | Thấp | Khi cần | Có tài khoản Zalo OA không? | ⏳ Chưa làm |
| 3 | **Bảng tính lương** (dựa trên chấm công) | Cao | Phase 4 | — | ✅ Xong (08/10/2026) |
| 5 | **Nghỉ có phép trong bảng lương** (nối module Lịch làm việc / xin nghỉ với bảng lương) | Trung bình | Phase 5 | — (đã chốt: QTV đánh dấu có lương, 1 ngày nghỉ = 1 ngày công lương cố định) | ✅ Xong (08/10/2026) |
| 4 | **Bật "Leaked password protection"** trong Supabase Auth | Thấp | Khi nâng gói Supabase (có thể chỉ có ở gói trả phí) | — | ⏳ Chưa làm |

## Ghi chú ước tính dung lượng ảnh

- Ảnh sau khi thu nhỏ ≈ 350 KB. 20 ảnh/ngày ≈ 7 MB/ngày ≈ 210 MB/tháng (1 chi nhánh).
- Gói Free Supabase: 1 GB lưu file → đầy sau khoảng 4–5 tháng nếu không dọn.
