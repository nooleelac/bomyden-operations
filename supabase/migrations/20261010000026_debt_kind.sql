-- Loại thông báo nhắc công nợ (tách riêng: giá trị enum mới phải commit trước khi dùng)
alter type public.notification_kind add value if not exists 'debt_due';
