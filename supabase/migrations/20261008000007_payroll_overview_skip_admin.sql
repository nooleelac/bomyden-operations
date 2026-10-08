-- Không cảnh báo "thiếu hồ sơ lương" cho Quản trị viên (chủ quán thường không nhận lương qua app)
create or replace function public.payroll_overview(p_period public.pay_period, p_period_start date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_items   jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_end     date := private.payroll_period_end(p_period, p_period_start);
  v_from    timestamptz := p_period_start::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to      timestamptz := (private.payroll_period_end(p_period, p_period_start) + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_slip    public.payslips;
  r         record;
begin
  if not private.has_payroll_access() then
    raise exception 'Bạn không có quyền xem bảng lương.' using errcode = '42501';
  end if;
  if not private.payroll_valid_start(p_period, p_period_start) then
    raise exception 'Ngày bắt đầu kỳ không hợp lệ.' using errcode = 'P0001';
  end if;

  for r in
    select e.id, e.full_name, e.is_active, e.role, pp.pay_period
    from public.employees e
    left join public.payroll_profiles pp on pp.employee_id = e.id
    where private.can_manage_payroll_for(e.id)
      and (e.is_active or exists (
        select 1 from public.attendance_records a
        where a.employee_id = e.id and a.check_in_at >= v_from and a.check_in_at < v_to
      ))
    order by e.sort_order, e.full_name
  loop
    if r.pay_period is null then
      if r.is_active and r.role <> 'admin' then
        v_missing := v_missing || jsonb_build_object('employee_id', r.id, 'full_name', r.full_name);
      end if;
      continue;
    end if;
    if r.pay_period <> p_period then
      continue;
    end if;

    select * into v_slip from public.payslips p where p.employee_id = r.id and p.period_start = p_period_start;
    if v_slip.id is not null then
      v_items := v_items || (v_slip.data || jsonb_build_object(
        'finalized', true, 'can_finalize', false, 'payslip_id', v_slip.id, 'finalized_at', v_slip.finalized_at));
    else
      v_items := v_items || private.compute_payslip(r.id, p_period_start);
    end if;
  end loop;

  return jsonb_build_object('period_start', p_period_start, 'period_end', v_end, 'items', v_items, 'missing_profiles', v_missing);
end;
$$;
