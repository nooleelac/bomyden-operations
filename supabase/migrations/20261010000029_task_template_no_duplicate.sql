-- =====================================================================
-- KHÔNG GIAO TRÙNG VIỆC CHO 1 NHÂN VIÊN (10/10/2026)
-- =====================================================================
--   * Trong cùng chi nhánh, 1 nhân viên không được là người phụ trách chính của
--     2 mẫu ĐANG ÁP DỤNG có cùng tên (không phân biệt hoa/thường, khoảng trắng thừa).
--   * Mẫu tạm ngưng / chưa giao không tính.
--   * Trigger báo lỗi dễ hiểu; unique index là lớp chặn cuối (kể cả khi giao hàng loạt).
-- =====================================================================

create or replace function private.task_title_key(p_title text)
returns text
language sql immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_title), '\s+', ' ', 'g'))
$$;
revoke all on function private.task_title_key(text) from public;

-- Tên trigger xếp sau "task_templates_guard" → chạy sau khi tên đã được chuẩn hóa
create or replace function private.task_templates_no_duplicate()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.is_active and new.primary_employee_id is not null and exists (
    select 1 from public.task_templates t
    where t.id <> new.id
      and t.branch_id = new.branch_id
      and t.primary_employee_id = new.primary_employee_id
      and t.is_active
      and private.task_title_key(t.title) = private.task_title_key(new.title)
  ) then
    select e.full_name into v_name from public.employees e where e.id = new.primary_employee_id;
    raise exception '% đã được giao công việc "%" ở chi nhánh này. Không giao trùng việc cho 1 nhân viên.', v_name, new.title
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger task_templates_no_duplicate
before insert or update on public.task_templates
for each row execute function private.task_templates_no_duplicate();

create unique index task_templates_no_duplicate_idx
on public.task_templates (branch_id, primary_employee_id, private.task_title_key(title))
where is_active and primary_employee_id is not null;
