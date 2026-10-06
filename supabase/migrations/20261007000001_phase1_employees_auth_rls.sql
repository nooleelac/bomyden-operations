-- =====================================================================
-- PHASE 1 — NỀN MÓNG: NHÂN VIÊN, PHÂN QUYỀN, RLS, AUDIT LOG
-- =====================================================================
-- Nguyên tắc:
--   * employees.id là khóa nghiệp vụ. auth.users.id CHỈ nằm ở employees.auth_user_id.
--   * Mọi bảng bật RLS. Hàm kiểm tra quyền nằm ở schema private (không lộ qua API).
--   * Không xóa nhân viên: chỉ khóa (is_active = false).
--   * Quy tắc leo thang quyền được ép ở DB bằng trigger, không chỉ ở UI.
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. ROLE
-- ---------------------------------------------------------------------
create type public.employee_role as enum (
  'admin',      -- Quản trị viên
  'manager',    -- Quản lý
  'head_chef',  -- Bếp chính
  'staff',      -- Nhân viên
  'server',     -- Phục vụ
  'cashier'     -- Thu ngân
);

-- ---------------------------------------------------------------------
-- 2. EMPLOYEES
-- ---------------------------------------------------------------------
create table public.employees (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid not null unique references auth.users (id) on delete restrict,
  full_name          text not null,
  email              text unique,
  phone              text unique,
  role               public.employee_role not null default 'staff',
  is_active          boolean not null default true,
  default_start_time time,
  sort_order         integer not null default 0,
  deactivated_at     timestamptz,
  deactivated_by     uuid references public.employees (id),
  created_at         timestamptz not null default now(),
  created_by         uuid references public.employees (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.employees (id),

  constraint employees_full_name_len  check (char_length(btrim(full_name)) between 1 and 120),
  constraint employees_contact_req    check (email is not null or phone is not null),
  constraint employees_email_format   check (email is null or (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint employees_phone_format   check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint employees_deactivated_ck check ((is_active and deactivated_at is null) or (not is_active and deactivated_at is not null))
);

comment on table  public.employees is 'Nhân viên. id = khóa nghiệp vụ; auth_user_id = liên kết Supabase Auth.';
comment on column public.employees.phone is 'Định dạng E.164, ví dụ +84901234567';

create index employees_active_sort_idx on public.employees (is_active, sort_order, full_name);

-- ---------------------------------------------------------------------
-- 3. AUDIT LOG
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id                bigint generated always as identity primary key,
  table_name        text not null,
  record_id         uuid,
  action            text not null,
  actor_auth_uid    uuid,
  actor_employee_id uuid references public.employees (id),
  old_data          jsonb,
  new_data          jsonb,
  note              text,
  created_at        timestamptz not null default now()
);

create index audit_logs_record_idx  on public.audit_logs (table_name, record_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- ---------------------------------------------------------------------
-- 4. HÀM PHÂN QUYỀN (SECURITY DEFINER, chỉ đọc)
-- ---------------------------------------------------------------------
create or replace function private.current_employee_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.auth_user_id = (select auth.uid())
    and e.is_active
$$;

create or replace function private.current_employee_role()
returns public.employee_role
language sql stable security definer
set search_path = ''
as $$
  select e.role
  from public.employees e
  where e.auth_user_id = (select auth.uid())
    and e.is_active
$$;

create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.current_employee_role() = 'admin', false)
$$;

create or replace function private.is_manager_or_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(private.current_employee_role() in ('admin', 'manager'), false)
$$;

revoke all on function private.current_employee_id()   from public;
revoke all on function private.current_employee_role() from public;
revoke all on function private.is_admin()              from public;
revoke all on function private.is_manager_or_admin()   from public;
grant execute on function private.current_employee_id()   to authenticated, service_role;
grant execute on function private.current_employee_role() to authenticated, service_role;
grant execute on function private.is_admin()              to authenticated, service_role;
grant execute on function private.is_manager_or_admin()   to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. TRIGGER: QUY TẮC NGHIỆP VỤ + CHỐNG LEO THANG QUYỀN
-- ---------------------------------------------------------------------
create or replace function private.employees_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id   uuid;
  v_actor_role public.employee_role;
  v_admins     integer;
begin
  -- Chuẩn hóa dữ liệu
  new.full_name := btrim(new.full_name);
  new.email     := nullif(lower(btrim(new.email)), '');
  new.phone     := nullif(btrim(new.phone), '');

  -- Mốc khóa / mở khóa
  if tg_op = 'INSERT' or new.is_active is distinct from old.is_active then
    if new.is_active then
      new.deactivated_at := null;
      new.deactivated_by := null;
    else
      new.deactivated_at := coalesce(new.deactivated_at, now());
    end if;
  end if;

  new.updated_at := now();

  -- Không có người dùng đăng nhập = service_role / SQL quản trị (bootstrap): cho phép.
  if (select auth.uid()) is null then
    return new;
  end if;

  select e.id, e.role into v_actor_id, v_actor_role
  from public.employees e
  where e.auth_user_id = (select auth.uid()) and e.is_active;

  if v_actor_id is null or v_actor_role not in ('admin', 'manager') then
    raise exception 'Bạn không có quyền quản lý nhân viên.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := v_actor_id;
    new.updated_by := v_actor_id;
    new.created_at := now();
    if new.role = 'admin' and v_actor_role <> 'admin' then
      raise exception 'Chỉ Quản trị viên mới được tạo tài khoản Quản trị viên.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  new.updated_by := v_actor_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;

  if new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'Không được thay đổi tài khoản đăng nhập liên kết.' using errcode = '42501';
  end if;

  if v_actor_role <> 'admin' and (old.role = 'admin' or new.role = 'admin') then
    raise exception 'Chỉ Quản trị viên mới được thay đổi tài khoản Quản trị viên.' using errcode = '42501';
  end if;

  if old.id = v_actor_id then
    if new.role is distinct from old.role then
      raise exception 'Bạn không thể tự thay đổi chức vụ của mình.' using errcode = '42501';
    end if;
    if not new.is_active then
      raise exception 'Bạn không thể tự khóa tài khoản của mình.' using errcode = '42501';
    end if;
  end if;

  if not new.is_active and old.is_active then
    new.deactivated_by := v_actor_id;
  end if;

  -- Luôn phải còn ít nhất 1 Quản trị viên đang hoạt động
  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active) then
    select count(*) into v_admins
    from public.employees e
    where e.role = 'admin' and e.is_active and e.id <> old.id;
    if v_admins = 0 then
      raise exception 'Hệ thống phải còn ít nhất một Quản trị viên đang hoạt động.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger employees_guard
before insert or update on public.employees
for each row execute function private.employees_guard();

-- Không ai được xóa nhân viên qua API
create or replace function private.forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Không được xóa dữ liệu %. Hãy dùng chức năng khóa.', tg_table_name using errcode = '42501';
end;
$$;

create trigger employees_forbid_delete
before delete on public.employees
for each row execute function private.forbid_delete();

-- ---------------------------------------------------------------------
-- 6. TRIGGER AUDIT LOG
-- ---------------------------------------------------------------------
create or replace function private.write_audit_log()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, old_data, new_data)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    tg_op,
    (select auth.uid()),
    private.current_employee_id(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger employees_audit
after insert or update on public.employees
for each row execute function private.write_audit_log();

-- Audit log là append-only
create trigger audit_logs_forbid_delete
before delete on public.audit_logs
for each row execute function private.forbid_delete();

create or replace function private.forbid_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Không được sửa dữ liệu %.', tg_table_name using errcode = '42501';
end;
$$;

create trigger audit_logs_forbid_update
before update on public.audit_logs
for each row execute function private.forbid_update();

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------
alter table public.employees  enable row level security;
alter table public.audit_logs enable row level security;

-- anon không được chạm vào bất kỳ bảng nào
revoke all on public.employees  from anon;
revoke all on public.audit_logs from anon;

-- authenticated: không DELETE; audit_logs chỉ SELECT
revoke delete on public.employees from authenticated;
revoke insert, update, delete, truncate on public.audit_logs from authenticated;

-- EMPLOYEES
create policy "employees_select_self_or_manager"
on public.employees for select
to authenticated
using (
  auth_user_id = (select auth.uid())
  or (select private.is_manager_or_admin())
);

create policy "employees_insert_manager"
on public.employees for insert
to authenticated
with check ((select private.is_manager_or_admin()));

create policy "employees_update_manager"
on public.employees for update
to authenticated
using ((select private.is_manager_or_admin()))
with check ((select private.is_manager_or_admin()));

-- AUDIT LOGS: chỉ Quản trị viên xem
create policy "audit_logs_select_admin"
on public.audit_logs for select
to authenticated
using ((select private.is_admin()));
