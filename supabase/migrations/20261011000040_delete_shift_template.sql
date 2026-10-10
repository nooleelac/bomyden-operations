-- =====================================================================
-- XÓA MẪU CA (11/10/2026)
-- =====================================================================
--   * QTV / QL (chi nhánh mình) được xóa mẫu ca.
--   * Mẫu chưa từng được dùng (không có ca / đăng ký ca nào) → xóa hẳn.
--   * Mẫu đã dùng → "xóa mềm": ngưng + ẩn khỏi danh sách; ca & đăng ký cũ vẫn giữ nguyên.
--   * Tên mẫu đã xóa được dùng lại cho mẫu mới.
--   * Xóa hẳn chỉ đi qua hàm này (cờ giao dịch app.allow_shift_template_delete); bảng vẫn cấm DELETE trực tiếp.
-- =====================================================================

alter table public.shift_templates add column deleted_at timestamptz;

-- Tên chỉ cần duy nhất trong các mẫu chưa xóa
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'shift_templates_name_unique') then
    alter table public.shift_templates drop constraint shift_templates_name_unique;
  end if;
end $$;
drop index if exists public.shift_templates_name_unique;
create unique index shift_templates_name_unique on public.shift_templates (branch_id, name) where deleted_at is null;

-- Mẫu đã xóa không được sửa / bật lại
create or replace function private.shift_templates_deleted_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    raise exception 'Mẫu ca "%" đã bị xóa.', old.name using errcode = 'P0001';
  end if;
  if new.deleted_at is not null then
    new.is_active := false;
  end if;
  return new;
end;
$$;

create trigger shift_templates_deleted_guard
before update on public.shift_templates
for each row execute function private.shift_templates_deleted_guard();

-- Cấm xóa trực tiếp, trừ khi đi qua hàm xóa bên dưới
create or replace function private.forbid_shift_template_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_shift_template_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Không được xóa dữ liệu %. Hãy dùng chức năng xóa mẫu ca.', tg_table_name using errcode = '42501';
end;
$$;

drop trigger shift_templates_forbid_delete on public.shift_templates;
create trigger shift_templates_forbid_delete
before delete on public.shift_templates
for each row execute function private.forbid_shift_template_delete();

-- Trả về 'deleted' (xóa hẳn) hoặc 'archived' (xóa mềm)
create or replace function public.delete_shift_template(p_template_id uuid)
returns text
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_t public.shift_templates;
begin
  if private.current_employee_id() is null then
    raise exception 'Tài khoản không hợp lệ.' using errcode = '42501';
  end if;

  select * into v_t from public.shift_templates t where t.id = p_template_id and t.deleted_at is null for update;
  if v_t.id is null or not private.manages_branch(v_t.branch_id) then
    raise exception 'Không tìm thấy mẫu ca hoặc bạn không có quyền.' using errcode = '42501';
  end if;

  if exists (select 1 from public.shifts s where s.template_id = v_t.id)
     or exists (select 1 from public.shift_registrations r where r.template_id = v_t.id) then
    update public.shift_templates set deleted_at = now(), is_active = false where id = v_t.id;
    return 'archived';
  end if;

  perform set_config('app.allow_shift_template_delete', 'on', true);
  delete from public.shift_templates t where t.id = v_t.id;
  perform set_config('app.allow_shift_template_delete', 'off', true);
  insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, old_data)
  values ('shift_templates', v_t.id, 'DELETE', (select auth.uid()), private.current_employee_id(), to_jsonb(v_t));
  return 'deleted';
end;
$$;

revoke all on function public.delete_shift_template(uuid) from public, anon;
grant execute on function public.delete_shift_template(uuid) to authenticated;
revoke all on function private.shift_templates_deleted_guard() from public;
revoke all on function private.forbid_shift_template_delete() from public;
