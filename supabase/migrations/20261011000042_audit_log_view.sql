-- =====================================================================
-- Nhật ký thao tác (trang xem cho Quản trị viên)
-- Chốt 11/10/2026: chỉ QTV xem; chỉ ghi thao tác quản lý (KHÔNG ghi việc thường ngày
-- của NV trên dữ liệu của chính mình: vào/ra ca, đánh dấu checklist, gửi đơn, đăng ký ca,
-- yêu cầu sửa chấm công, ứng lương); giữ 12 tháng; lưu dữ liệu trước/sau để so sánh.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CỘT LỌC: chi nhánh + nhân viên liên quan (tự suy ra từ dữ liệu dòng)
-- ---------------------------------------------------------------------
alter table public.audit_logs
  add column if not exists branch_id          uuid references public.branches (id) on delete set null,
  add column if not exists target_employee_id uuid references public.employees (id) on delete set null;

create index if not exists audit_logs_branch_idx on public.audit_logs (branch_id, created_at desc);
create index if not exists audit_logs_target_employee_idx on public.audit_logs (target_employee_id, created_at desc);
create index if not exists audit_logs_actor_created_idx on public.audit_logs (actor_employee_id, created_at desc);

create or replace function private.audit_logs_fill()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_data jsonb := coalesce(new.new_data, new.old_data, '{}'::jsonb);
  v_branch uuid;
  v_emp uuid;
begin
  if new.branch_id is null and v_data ? 'branch_id' then
    v_branch := nullif(v_data ->> 'branch_id', '')::uuid;
    if exists (select 1 from public.branches b where b.id = v_branch) then
      new.branch_id := v_branch;
    end if;
  end if;
  if new.target_employee_id is null then
    v_emp := case
      when new.table_name = 'employees' then nullif(v_data ->> 'id', '')::uuid
      else nullif(coalesce(v_data ->> 'employee_id', v_data ->> 'primary_employee_id'), '')::uuid
    end;
    if v_emp is not null and exists (select 1 from public.employees e where e.id = v_emp) then
      new.target_employee_id := v_emp;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.audit_logs_fill() from public;

drop trigger if exists audit_logs_fill on public.audit_logs;
create trigger audit_logs_fill
before insert on public.audit_logs
for each row execute function private.audit_logs_fill();

-- Điền cho các dòng cũ (bảng append-only → tạm tắt trigger chặn sửa trong migration)
alter table public.audit_logs disable trigger audit_logs_forbid_update;
update public.audit_logs a set
  branch_id = case
    when (coalesce(a.new_data, a.old_data) ->> 'branch_id') is not null
     and exists (select 1 from public.branches b where b.id = (coalesce(a.new_data, a.old_data) ->> 'branch_id')::uuid)
    then (coalesce(a.new_data, a.old_data) ->> 'branch_id')::uuid
  end,
  target_employee_id = (
    select e.id from public.employees e
    where e.id = (case
      when a.table_name = 'employees' then coalesce(a.new_data, a.old_data) ->> 'id'
      else coalesce(coalesce(a.new_data, a.old_data) ->> 'employee_id', coalesce(a.new_data, a.old_data) ->> 'primary_employee_id')
    end)::uuid
  );
alter table public.audit_logs enable trigger audit_logs_forbid_update;

-- ---------------------------------------------------------------------
-- 2. KHÔNG GHI thao tác tự phục vụ của nhân viên
-- ---------------------------------------------------------------------
-- Bảng "tự phục vụ": NV tự tạo/sửa dòng của chính mình. Bỏ qua khi:
--   - người thao tác không phải QTV/QL (nhân viên, bếp chính, phục vụ, thu ngân), hoặc
--   - người thao tác chính là nhân viên của dòng (VD Quản lý tự ra ca), hoặc
--   - hệ thống tự chạy (không có người thao tác, VD cron đánh dấu quên ra ca).
-- Duyệt / sửa / từ chối do QL/QTV làm trên dữ liệu người khác vẫn được ghi.
create or replace function private.audit_skip_self_service(p_table text, p_row jsonb)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if p_table not in (
    'attendance_records', 'attendance_corrections', 'schedule_requests',
    'shift_registrations', 'salary_advances', 'task_instances'
  ) then
    return false;
  end if;

  v_actor := private.current_employee_id();
  -- Hệ thống tự chạy, hoặc nhân viên (mọi chức vụ không phải QTV/QL)
  if v_actor is null or not private.is_manager_or_admin() then
    return true;
  end if;
  return v_actor::text in (
    coalesce(p_row ->> 'employee_id', ''),
    coalesce(p_row ->> 'primary_employee_id', ''),
    coalesce(p_row ->> 'backup_employee_id', ''),
    coalesce(p_row ->> 'completed_by', '')
  );
end;
$$;
revoke all on function private.audit_skip_self_service(text, jsonb) from public;

create or replace function private.write_audit_log()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
begin
  if private.audit_skip_self_service(tg_table_name, coalesce(v_new, v_old)) then
    return coalesce(new, old);
  end if;
  -- Sửa mà không đổi gì (ngoài giờ cập nhật) → không ghi
  if tg_op = 'UPDATE' and (v_new - 'updated_at') = (v_old - 'updated_at') then
    return new;
  end if;

  insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, old_data, new_data)
  values (
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'employee_id', v_old ->> 'employee_id')::uuid,
    tg_op,
    (select auth.uid()),
    private.current_employee_id(),
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

create or replace function private.task_instances_audit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and (new.status in ('done', 'failed') or old.status in ('done', 'failed'))
     and not private.audit_skip_self_service('task_instances', to_jsonb(new)) then
    insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, old_data, new_data)
    values ('task_instances', new.id, 'UPDATE', (select auth.uid()), private.current_employee_id(), to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;

-- Thương hiệu (logo, tên, màu) cũng là thao tác quản trị
drop trigger if exists app_settings_audit on public.app_settings;
create trigger app_settings_audit
after insert or update on public.app_settings
for each row execute function private.settings_audit();

-- ---------------------------------------------------------------------
-- 3. GIỮ 12 THÁNG: dọn hằng ngày (chỉ hàm dọn được phép xóa)
-- ---------------------------------------------------------------------
create or replace function private.audit_logs_forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.audit_purge', true) = 'on' and old.created_at < now() - interval '12 months' then
    return old;
  end if;
  raise exception 'Không được xóa nhật ký thao tác.' using errcode = '42501';
end;
$$;
revoke all on function private.audit_logs_forbid_delete() from public;

drop trigger if exists audit_logs_forbid_delete on public.audit_logs;
create trigger audit_logs_forbid_delete
before delete on public.audit_logs
for each row execute function private.audit_logs_forbid_delete();

create or replace function private.run_daily_cleanup()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  -- Thông báo trên app giữ 60 ngày
  delete from public.notifications n where n.created_at < now() - interval '60 days';

  -- Nhật ký thao tác giữ 12 tháng
  perform set_config('app.audit_purge', 'on', true);
  delete from public.audit_logs a where a.created_at < now() - interval '12 months';
  perform set_config('app.audit_purge', 'off', true);

  if exists (
    select 1 from public.task_instances t
    where t.photo_path is not null and t.photo_purged_at is null
      and coalesce(t.completed_at, t.created_at) < now() - interval '3 months'
  ) or exists (
    select 1 from public.invoice_scans s
    where s.photo_purged_at is null
      and ((s.receipt_id is null and s.created_at < now() - interval '1 day') or s.created_at < now() - interval '12 months')
  ) then
    perform private.call_ops_job('cleanup');
  end if;
end;
$$;
revoke all on function private.run_daily_cleanup() from public;

-- ---------------------------------------------------------------------
-- 4. REALTIME: trang nhật ký tự cập nhật (RLS: chỉ QTV nhận)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_logs'
  ) then
    alter publication supabase_realtime add table public.audit_logs;
  end if;
end;
$$;
