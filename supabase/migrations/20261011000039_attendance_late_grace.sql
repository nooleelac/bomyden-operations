-- =====================================================================
-- BÁO CÁO CHẤM CÔNG: số phút ân hạn đi trễ (11/10/2026)
-- =====================================================================
--   Trang Quản lý chấm công đánh dấu "đi trễ" theo đúng quy tắc bảng lương
--   (ân hạn riêng từng NV, không có thì mức chung toàn quán, mặc định 5 phút).
--   QL không được đọc bảng lương → hàm chỉ trả số phút ân hạn của NV thuộc chi nhánh mình quản lý.
-- =====================================================================

create function public.attendance_late_grace(p_employee_ids uuid[])
returns table (employee_id uuid, grace_minutes integer)
language sql stable security definer
set search_path = ''
as $$
  select e.id, coalesce(p.late_grace_minutes, s.late_grace_minutes, 5)
  from public.employees e
  left join public.payroll_profiles p on p.employee_id = e.id
  left join public.payroll_settings s on s.id
  where e.id = any(p_employee_ids)
    and exists (
      select 1 from public.employee_branches eb
      where eb.employee_id = e.id and private.manages_branch(eb.branch_id)
    )
$$;

revoke all on function public.attendance_late_grace(uuid[]) from public, anon;
grant execute on function public.attendance_late_grace(uuid[]) to authenticated;
