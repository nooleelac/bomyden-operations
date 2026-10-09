-- Loại thông báo mới cho đơn xin phép & đăng ký ca (tách riêng: giá trị enum mới phải commit trước khi dùng)
alter type public.notification_kind add value if not exists 'request_new';
alter type public.notification_kind add value if not exists 'request_peer';
alter type public.notification_kind add value if not exists 'request_result';
alter type public.notification_kind add value if not exists 'registration_new';
alter type public.notification_kind add value if not exists 'registration_result';

-- Tham chiếu chung (id đơn / id nhân viên…) cho thông báo không thuộc checklist
alter table public.notifications add column if not exists ref_id uuid;
create index if not exists notifications_ref_idx on public.notifications (kind, ref_id);
