-- Loại thông báo cho đơn ứng lương (tách migration: giá trị enum mới phải commit trước khi dùng)
alter type public.notification_kind add value if not exists 'advance_new';
alter type public.notification_kind add value if not exists 'advance_result';
