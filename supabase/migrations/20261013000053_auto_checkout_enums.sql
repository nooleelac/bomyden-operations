-- Tự chốt ca khi quên ra ca: giá trị enum mới (tách migration riêng — giá trị enum mới
-- không dùng được trong cùng transaction tạo ra nó).
alter type public.attendance_method add value if not exists 'auto';
alter type public.notification_kind add value if not exists 'checkout_reminder';
alter type public.notification_kind add value if not exists 'auto_checkout';
