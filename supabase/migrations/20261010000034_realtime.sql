-- =====================================================================
-- REALTIME (10/10/2026)
-- =====================================================================
--   * Phát thay đổi của: việc theo ngày (checklist), thông báo (chuông), chấm công (tổng quan QL).
--   * Supabase Realtime áp RLS cho từng người nghe → ai chỉ nhận thay đổi của dòng mình được xem.
--   * App chỉ dùng tín hiệu "có thay đổi" để tải lại phần dữ liệu trên trang (đọc lại qua RLS).
-- =====================================================================

alter publication supabase_realtime add table public.task_instances;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.attendance_records;
