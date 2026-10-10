-- =====================================================================
-- BỘ VIỆC (10/10/2026)
-- =====================================================================
--   * Bộ việc = nhóm mẫu công việc trong CÙNG chi nhánh (VD "Mở ca", "Đóng ca").
--   * Mỗi mẫu thuộc tối đa 1 bộ. Giao cả bộ = giao hàng loạt mọi mẫu trong bộ (người / theo ca).
--   * QTV + QL (chi nhánh mình) tạo / đổi tên / xóa bộ. Xóa bộ chỉ gỡ nhóm, KHÔNG xóa mẫu.
--   * Tên bộ không trùng trong chi nhánh (không phân biệt hoa/thường, khoảng trắng thừa).
-- =====================================================================

create table public.task_sets (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches (id),
  name       text not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees (id),
  constraint task_sets_name_len check (char_length(btrim(name)) between 1 and 50)
);
create unique index task_sets_name_unique on public.task_sets (branch_id, private.task_title_key(name));
create index task_sets_created_by_idx on public.task_sets (created_by);
create index task_sets_updated_by_idx on public.task_sets (updated_by);

create or replace function private.task_sets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  if tg_op = 'UPDATE' and new.branch_id <> old.branch_id then
    raise exception 'Không được chuyển bộ việc sang chi nhánh khác.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.task_sets s
    where s.id <> new.id and s.branch_id = new.branch_id
      and private.task_title_key(s.name) = private.task_title_key(new.name)
  ) then
    raise exception 'Đã có bộ việc "%" ở chi nhánh này.', new.name using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger task_sets_guard
before insert or update on public.task_sets
for each row execute function private.task_sets_guard();
create trigger task_sets_stamp
before insert or update on public.task_sets
for each row execute function private.stamp_row();
create trigger task_sets_audit
after insert or update on public.task_sets
for each row execute function private.write_audit_log();

-- Mẫu ↔ bộ
alter table public.task_templates add column set_id uuid references public.task_sets (id);
create index task_templates_set_idx on public.task_templates (set_id);

create or replace function private.task_templates_set_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.set_id is not null and not exists (
    select 1 from public.task_sets s where s.id = new.set_id and s.branch_id = new.branch_id
  ) then
    raise exception 'Bộ việc phải cùng chi nhánh với công việc "%".', new.title using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger task_templates_set_guard
before insert or update of set_id on public.task_templates
for each row execute function private.task_templates_set_guard();

-- Xóa mềm mẫu → gỡ khỏi bộ (để xóa bộ sau này không vướng mẫu đã xóa)
create or replace function private.task_templates_deleted_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    raise exception 'Công việc "%" đã bị xóa.', old.title using errcode = 'P0001';
  end if;
  -- Chạy trước task_templates_guard (theo tên) → bỏ giao để không vướng kiểm tra nhân viên đã nghỉ
  if new.deleted_at is not null then
    new.is_active := false;
    new.assign_by_shift := false;
    new.primary_employee_id := null;
    new.backup_employee_id := null;
    new.set_id := null;
  end if;
  return new;
end;
$$;

-- Xóa bộ: gỡ nhóm khỏi mẫu rồi xóa bộ
create or replace function public.delete_task_set(p_set_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_set public.task_sets;
begin
  select * into v_set from public.task_sets s where s.id = p_set_id for update;
  if v_set.id is null or not private.manages_branch(v_set.branch_id) then
    raise exception 'Không tìm thấy bộ việc hoặc bạn không có quyền.' using errcode = '42501';
  end if;

  update public.task_templates set set_id = null where set_id = v_set.id;

  delete from public.task_sets where id = v_set.id;
  insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, old_data)
  values ('task_sets', v_set.id, 'DELETE', (select auth.uid()), private.current_employee_id(), to_jsonb(v_set));
end;
$$;

revoke all on function public.delete_task_set(uuid) from public, anon;
grant execute on function public.delete_task_set(uuid) to authenticated;
revoke all on function private.task_sets_guard() from public;
revoke all on function private.task_templates_set_guard() from public;

-- RLS
alter table public.task_sets enable row level security;
revoke all on public.task_sets from anon;
revoke delete, truncate on public.task_sets from authenticated;

create policy "task_sets_select" on public.task_sets for select to authenticated
using ((select private.manages_branch(branch_id)));
create policy "task_sets_insert" on public.task_sets for insert to authenticated
with check ((select private.manages_branch(branch_id)));
create policy "task_sets_update" on public.task_sets for update to authenticated
using ((select private.manages_branch(branch_id)))
with check ((select private.manages_branch(branch_id)));
