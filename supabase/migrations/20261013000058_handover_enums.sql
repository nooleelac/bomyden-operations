-- Loại thông báo cho Bàn giao ca (tách riêng: giá trị enum mới phải commit trước khi dùng)
alter type public.notification_kind add value if not exists 'handover_new';
alter type public.notification_kind add value if not exists 'handover_disputed';
