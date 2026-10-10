-- =====================================================================
-- THƯƠNG HIỆU (10/10/2026): tên app, logo, màu sắc do Quản trị viên đổi
-- =====================================================================
--   * 1 dòng duy nhất (id = true).
--   * Ai cũng đọc được (trang đăng nhập, biểu tượng app cần trước khi đăng nhập).
--   * Chỉ Quản trị viên sửa. Logo nằm ở kho file công khai `branding`
--     (app tải lên bằng khóa quản trị sau khi kiểm tra quyền).
-- =====================================================================

create table public.app_settings (
  id boolean primary key default true check (id),
  brand_name text not null default 'Bò Mỹ Đen' check (char_length(brand_name) between 1 and 60),
  short_name text not null default 'BMĐ' check (char_length(short_name) between 1 and 6),
  tagline text not null default 'Hệ thống vận hành quán' check (char_length(tagline) <= 80),
  primary_color text not null default '#171717' check (primary_color ~ '^#[0-9a-f]{6}$'),
  header_color text not null default '#171717' check (header_color ~ '^#[0-9a-f]{6}$'),
  logo_path text check (char_length(logo_path) <= 200),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null
);

create index app_settings_updated_by_idx on public.app_settings (updated_by);

insert into public.app_settings (id) values (true);

alter table public.app_settings enable row level security;

revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant update (brand_name, short_name, tagline, primary_color, header_color, logo_path, updated_at, updated_by)
  on public.app_settings to authenticated;

create policy app_settings_select on public.app_settings
  for select to anon, authenticated
  using (true);

create policy app_settings_update on public.app_settings
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create trigger app_settings_no_delete
before delete on public.app_settings
for each row execute function private.forbid_delete();

-- Kho logo công khai (≤ 1 MB, chỉ ảnh raster — không nhận SVG để tránh chèn mã)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']);

alter publication supabase_realtime add table public.app_settings;
