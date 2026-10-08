# BACKLOG — Việc đã hẹn làm sau

> Cuối mỗi phase, kiểm tra danh sách này và nhắc những việc đã đến hạn.
> Cập nhật trạng thái khi làm xong (✅) hoặc khi đổi kế hoạch.

| # | Việc | Ưu tiên | Làm khi nào | Cần quyết định | Trạng thái |
|---|---|---|---|---|---|
| 1 | **Tự dọn ảnh checklist cũ** (xóa ảnh trong kho `task-photos` cũ hơn N tháng, giữ lại dòng lịch sử trong DB) | Cao | **Trước khi dùng thật cho cả quán** (cùng đợt deploy) | N = bao nhiêu tháng? (gợi ý 3 tháng). Ảnh việc "Không đạt" có giữ lâu hơn không? | ⏳ Chưa làm |
| 2 | **Thông báo việc sắp quá hạn / quá hạn** cho nhân viên phụ trách và quản lý | Trung bình | **Cùng đợt deploy** (cần HTTPS / tài khoản Zalo) | Kênh: thông báo trên app (web push), Zalo OA, hay cả hai? Báo trước hạn bao nhiêu phút? | ⏳ Chưa làm |
| 3 | **Bảng tính lương** (dựa trên chấm công) | Cao | Phase 4 | — | ✅ Xong (08/10/2026) |
| 5 | **Nghỉ có phép trong bảng lương**: nối module Lịch làm việc / xin nghỉ với bảng lương (ngày nghỉ có phép không bị trừ lương cố định; đi trễ so với lịch thay vì giờ mặc định) | Trung bình | Khi làm module Lịch làm việc | Nghỉ có phép được hưởng bao nhiêu % lương? | ⏳ Chưa làm |
| 4 | **Bật "Leaked password protection"** trong Supabase Auth | Thấp | Khi nâng gói Supabase (có thể chỉ có ở gói trả phí) | — | ⏳ Chưa làm |

## Ghi chú ước tính dung lượng ảnh

- Ảnh sau khi thu nhỏ ≈ 350 KB. 20 ảnh/ngày ≈ 7 MB/ngày ≈ 210 MB/tháng (1 chi nhánh).
- Gói Free Supabase: 1 GB lưu file → đầy sau khoảng 4–5 tháng nếu không dọn.
