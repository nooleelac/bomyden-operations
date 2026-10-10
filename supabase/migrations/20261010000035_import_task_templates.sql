-- =====================================================================
-- NHẬP MẪU CÔNG VIỆC HÀNG LOẠT TỪ EXCEL (10/10/2026)
-- =====================================================================
--   * Server đọc file Excel, kiểm tra từng dòng, rồi gọi hàm này với danh sách đã chuẩn hóa.
--   * Tất cả hoặc không: lỗi ở 1 dòng (trùng việc, nhân viên không thuộc chi nhánh...) → không nhập gì.
--   * Bộ việc ghi trong file mà chưa có → tự tạo trong chi nhánh.
--   * Chạy bằng quyền người gọi (security invoker) → RLS + mọi trigger kiểm tra của mẫu vẫn áp dụng.
-- =====================================================================

create or replace function public.import_task_templates(p_branch_id uuid, p_rows jsonb)
returns integer
language plpgsql volatile security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.manages_branch(p_branch_id) then
    raise exception 'Bạn không có quyền với chi nhánh này.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'File không có công việc nào.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Mỗi lần nhập tối đa 500 công việc.' using errcode = 'P0001';
  end if;

  -- Bộ việc chưa có → tạo mới
  insert into public.task_sets (branch_id, name)
  select distinct on (private.task_title_key(r->>'set_name')) p_branch_id, btrim(r->>'set_name')
  from jsonb_array_elements(p_rows) r
  where nullif(btrim(r->>'set_name'), '') is not null
    and not exists (
      select 1 from public.task_sets s
      where s.branch_id = p_branch_id and private.task_title_key(s.name) = private.task_title_key(r->>'set_name')
    )
  order by private.task_title_key(r->>'set_name');

  insert into public.task_templates (
    branch_id, title, description, category, priority, start_time, due_time, frequency, weekdays, month_days,
    requires_photo, requires_note, assign_by_shift, primary_employee_id, backup_employee_id, set_id, sort_order
  )
  select
    p_branch_id,
    r->>'title',
    nullif(r->>'description', ''),
    r->>'category',
    (r->>'priority')::public.task_priority,
    (r->>'start_time')::time,
    (r->>'due_time')::time,
    (r->>'frequency')::public.task_frequency,
    coalesce(array(select jsonb_array_elements_text(r->'weekdays')::smallint), '{}'),
    coalesce(array(select jsonb_array_elements_text(r->'month_days')::smallint), '{}'),
    coalesce((r->>'requires_photo')::boolean, false),
    coalesce((r->>'requires_note')::boolean, false),
    coalesce((r->>'assign_by_shift')::boolean, false),
    nullif(r->>'primary_employee_id', '')::uuid,
    nullif(r->>'backup_employee_id', '')::uuid,
    (select s.id from public.task_sets s
     where s.branch_id = p_branch_id and private.task_title_key(s.name) = private.task_title_key(r->>'set_name')),
    coalesce((r->>'sort_order')::integer, 0)
  from jsonb_array_elements(p_rows) r;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.import_task_templates(uuid, jsonb) from public, anon;
grant execute on function public.import_task_templates(uuid, jsonb) to authenticated;
