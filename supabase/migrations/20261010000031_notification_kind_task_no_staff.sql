-- Loại thông báo mới cho việc "giao theo ca" mà không có ai trong ca (tách migration: giá trị enum mới phải commit trước khi dùng)
alter type public.notification_kind add value if not exists 'task_no_staff';
