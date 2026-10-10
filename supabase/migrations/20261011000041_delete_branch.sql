-- =====================================================================
-- XÓA CHI NHÁNH (11/10/2026)
-- =====================================================================
--   * Chỉ Quản trị viên.
--   * Chi nhánh CHƯA phát sinh dữ liệu (chấm công, lịch, đơn, kho, checklist đã làm) → xóa hẳn,
--     kèm phần cấu hình: gán nhân viên, mẫu ca, bộ việc / mẫu checklist + việc chưa làm, tồn kho = 0.
--   * Đã có dữ liệu → từ chối (giữ lịch sử lương / chấm công / kho); hướng dẫn tắt "Đang hoạt động" để ẩn.
--   * Xóa hẳn chỉ đi qua hàm này (cờ giao dịch app.allow_branch_delete); bảng vẫn cấm DELETE trực tiếp.
-- =====================================================================

create or replace function private.forbid_branch_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_branch_delete', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Không được xóa dữ liệu %. Hãy dùng chức năng xóa chi nhánh.', tg_table_name using errcode = '42501';
end;
$$;

drop trigger branches_forbid_delete on public.branches;
create trigger branches_forbid_delete
before delete on public.branches
for each row execute function private.forbid_branch_delete();

create or replace function public.delete_branch(p_branch_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_b    public.branches;
  v_what text[] := '{}';
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị viên được xóa chi nhánh.' using errcode = '42501';
  end if;
  select * into v_b from public.branches b where b.id = p_branch_id for update;
  if v_b.id is null then
    raise exception 'Không tìm thấy chi nhánh.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.attendance_records x where x.branch_id = v_b.id)
     or exists (select 1 from public.attendance_corrections x where x.branch_id = v_b.id) then
    v_what := v_what || 'chấm công'::text;
  end if;
  if exists (select 1 from public.shifts x where x.branch_id = v_b.id)
     or exists (select 1 from public.shift_registrations x where x.branch_id = v_b.id)
     or exists (select 1 from public.schedule_requests x where x.branch_id = v_b.id) then
    v_what := v_what || 'lịch làm / đơn xin phép'::text;
  end if;
  if exists (select 1 from public.task_instances x where x.branch_id = v_b.id and x.status in ('done', 'failed')) then
    v_what := v_what || 'checklist đã làm'::text;
  end if;
  if exists (select 1 from public.stock_movements x where x.branch_id = v_b.id)
     or exists (select 1 from public.stock_receipts x where x.branch_id = v_b.id)
     or exists (select 1 from public.stock_counts x where x.branch_id = v_b.id)
     or exists (select 1 from public.stock_issues x where x.branch_id = v_b.id or x.to_branch_id = v_b.id)
     or exists (select 1 from public.supplier_payments x where x.branch_id = v_b.id)
     or exists (select 1 from public.invoice_scans x where x.branch_id = v_b.id) then
    v_what := v_what || 'kho'::text;
  end if;

  if cardinality(v_what) > 0 then
    raise exception 'Chi nhánh "%" đã có dữ liệu % nên không xóa được (để giữ lịch sử lương, chấm công, kho). Hãy bấm Sửa và bỏ chọn "Đang hoạt động" để ẩn chi nhánh.',
      v_b.name, array_to_string(v_what, ', ') using errcode = 'P0001';
  end if;

  -- Dọn cấu hình chưa phát sinh dữ liệu
  perform set_config('app.allow_task_delete', 'on', true);
  perform set_config('app.allow_shift_template_delete', 'on', true);
  perform set_config('app.allow_branch_delete', 'on', true);

  delete from public.notifications n
  where n.task_instance_id in (select i.id from public.task_instances i where i.branch_id = v_b.id);
  delete from public.task_instances x where x.branch_id = v_b.id;
  delete from public.task_templates x where x.branch_id = v_b.id;
  delete from public.task_sets x where x.branch_id = v_b.id;
  delete from public.shift_templates x where x.branch_id = v_b.id;
  delete from public.stock_balances x where x.branch_id = v_b.id;
  delete from public.employee_branches x where x.branch_id = v_b.id;
  delete from public.branches b where b.id = v_b.id;

  perform set_config('app.allow_task_delete', 'off', true);
  perform set_config('app.allow_shift_template_delete', 'off', true);
  perform set_config('app.allow_branch_delete', 'off', true);

  insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, old_data)
  values ('branches', v_b.id, 'DELETE', (select auth.uid()), private.current_employee_id(), to_jsonb(v_b));
end;
$$;

revoke all on function public.delete_branch(uuid) from public, anon;
grant execute on function public.delete_branch(uuid) to authenticated;
revoke all on function private.forbid_branch_delete() from public;
