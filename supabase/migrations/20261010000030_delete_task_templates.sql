-- =====================================================================
-- XÓA MẪU CÔNG VIỆC (10/10/2026)
-- =====================================================================
--   * QTV / QL (chi nhánh mình) được xóa mẫu, xóa nhiều mẫu một lần.
--   * Mẫu CHƯA có việc nào đã đánh dấu (xong / không đạt) → xóa hẳn
--     (kèm việc theo ngày chưa làm + thông báo nhắc của các việc đó).
--   * Mẫu ĐÃ có lịch sử → "xóa mềm": ngưng + ẩn khỏi danh sách mẫu, báo cáo các ngày cũ vẫn giữ nguyên.
--   * Xóa hẳn chỉ đi qua hàm này (cờ giao dịch app.allow_task_delete); bảng vẫn cấm DELETE trực tiếp.
--   * Ghi audit_logs cho cả hai trường hợp.
-- =====================================================================

alter table public.task_templates add column deleted_at timestamptz;

-- Mẫu đã xóa mềm không được sửa / bật lại
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
    new.primary_employee_id := null;
    new.backup_employee_id := null;
  end if;
  return new;
end;
$$;

create trigger task_templates_deleted_guard
before update on public.task_templates
for each row execute function private.task_templates_deleted_guard();

-- Cấm xóa trực tiếp, trừ khi đi qua hàm xóa bên dưới
create or replace function private.forbid_task_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_task_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Không được xóa dữ liệu %. Hãy dùng chức năng xóa công việc.', tg_table_name using errcode = '42501';
end;
$$;

drop trigger task_templates_forbid_delete on public.task_templates;
create trigger task_templates_forbid_delete
before delete on public.task_templates
for each row execute function private.forbid_task_delete();

drop trigger task_instances_forbid_delete on public.task_instances;
create trigger task_instances_forbid_delete
before delete on public.task_instances
for each row execute function private.forbid_task_delete();

create or replace function public.delete_task_templates(p_template_ids uuid[])
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_t        public.task_templates;
  v_deleted  integer := 0;
  v_archived integer := 0;
begin
  if private.current_employee_id() is null then
    raise exception 'Tài khoản không hợp lệ.' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_template_ids), 0) = 0 then
    raise exception 'Chọn ít nhất một công việc.' using errcode = 'P0001';
  end if;

  perform set_config('app.allow_task_delete', 'on', true);

  for v_t in
    select * from public.task_templates t where t.id = any (p_template_ids) and t.deleted_at is null for update
  loop
    if not private.manages_branch(v_t.branch_id) then
      raise exception 'Bạn không có quyền xóa công việc "%".', v_t.title using errcode = '42501';
    end if;

    if exists (select 1 from public.task_instances i where i.template_id = v_t.id and i.status in ('done', 'failed')) then
      -- Có lịch sử → xóa mềm (trigger sync sẽ hủy việc chưa làm từ hôm nay)
      update public.task_templates set deleted_at = now(), is_active = false where id = v_t.id;
      v_archived := v_archived + 1;
    else
      delete from public.notifications n
      where n.task_instance_id in (select i.id from public.task_instances i where i.template_id = v_t.id);
      delete from public.task_instances i where i.template_id = v_t.id;
      delete from public.task_templates t where t.id = v_t.id;
      insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, old_data)
      values ('task_templates', v_t.id, 'DELETE', (select auth.uid()), private.current_employee_id(), to_jsonb(v_t));
      v_deleted := v_deleted + 1;
    end if;
  end loop;

  perform set_config('app.allow_task_delete', 'off', true);
  return jsonb_build_object('deleted', v_deleted, 'archived', v_archived);
end;
$$;

revoke all on function public.delete_task_templates(uuid[]) from public, anon;
grant execute on function public.delete_task_templates(uuid[]) to authenticated;
revoke all on function private.task_templates_deleted_guard() from public;
revoke all on function private.forbid_task_delete() from public;
