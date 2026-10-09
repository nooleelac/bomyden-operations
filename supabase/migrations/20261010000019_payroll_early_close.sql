-- Chốt lương sớm: NV nghỉ việc giữa kỳ → chốt từ đầu kỳ đến ngày chọn (≤ hôm nay).
-- Phiếu chốt sớm lưu period_end = ngày chốt; công sau ngày đó trong cùng kỳ không được tính.

-- ---------------------------------------------------------------------
-- 1. TÍNH LƯƠNG — thêm p_end_date (null = hết kỳ như cũ)
-- ---------------------------------------------------------------------
drop function private.compute_payslip(uuid, date);

create or replace function private.compute_payslip(p_employee_id uuid, p_period_start date, p_end_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_emp       public.employees;
  v_prof      public.payroll_profiles;
  v_set       public.payroll_settings;
  v_end       date;
  v_full_end  date;
  v_from      timestamptz;
  v_to        timestamptz;
  v_today     date := private.vn_today();
  v_lines     jsonb := '[]'::jsonb;
  v_warn      jsonb := '[]'::jsonb;
  v_total     integer := 0;
  v_ot        integer := 0;
  v_shifts    integer := 0;
  v_days      integer := 0;
  v_paid      integer := 0;
  v_late      text[] := '{}';
  v_early     text[] := '{}';
  v_absent    text[] := '{}';
  v_grace     integer;
  v_egrace    integer;
  v_pen_late  bigint;
  v_pen_early bigint;
  v_pen_abs   bigint;
  v_pen_fail  bigint;
  v_pen_miss  bigint;
  v_pen_tlat  bigint;
  v_amount    bigint;
  v_reg       integer;
  v_cnt       integer;
  v_dates     text;
  v_raw       bigint;
  v_gross     bigint;
  v_ded       bigint;
  v_base      timestamptz;
  v_out       timestamptz;
  v_shift     public.shifts;
  v_req_time  time;
  r           record;
begin
  select * into v_emp from public.employees e where e.id = p_employee_id;
  select * into v_prof from public.payroll_profiles pp where pp.employee_id = p_employee_id;
  if v_emp.id is null or v_prof.employee_id is null then
    return null;
  end if;
  if not private.payroll_valid_start(v_prof.pay_period, p_period_start) then
    raise exception 'Ngày bắt đầu kỳ không khớp kỳ lương của %.', v_emp.full_name using errcode = 'P0001';
  end if;

  select * into v_set from public.payroll_settings limit 1;
  v_full_end := private.payroll_period_end(v_prof.pay_period, p_period_start);
  v_end   := v_full_end;
  -- Chốt sớm (NV nghỉ việc giữa kỳ): chỉ tính từ đầu kỳ đến ngày chốt
  if p_end_date is not null then
    if p_end_date < p_period_start or p_end_date > v_full_end then
      raise exception 'Ngày chốt sớm phải nằm trong kỳ lương (% – %).', to_char(p_period_start, 'DD/MM'), to_char(v_full_end, 'DD/MM')
        using errcode = 'P0001';
    end if;
    v_end := p_end_date;
  end if;
  v_from  := p_period_start::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to    := (v_end + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_grace     := coalesce(v_prof.late_grace_minutes, v_set.late_grace_minutes);
  v_egrace    := coalesce(v_prof.early_grace_minutes, v_set.early_grace_minutes);
  v_pen_late  := coalesce(v_prof.late_penalty, v_set.late_penalty);
  v_pen_early := coalesce(v_prof.early_leave_penalty, v_set.early_leave_penalty);
  v_pen_abs   := coalesce(v_prof.absent_penalty, v_set.absent_penalty);
  v_pen_fail  := coalesce(v_prof.checklist_failed_penalty, v_set.checklist_failed_penalty);
  v_pen_miss  := coalesce(v_prof.checklist_missed_penalty, v_set.checklist_missed_penalty);
  v_pen_tlat  := coalesce(v_prof.checklist_late_penalty, v_set.checklist_late_penalty);

  -- Cảnh báo chặn chốt
  if exists (
    select 1 from public.attendance_records a
    where a.employee_id = p_employee_id and a.check_out_at is null and a.check_in_at < v_to
  ) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', true, 'message', 'Còn ca chưa ra ca (cần xử lý trước khi chốt).'));
  end if;
  if exists (
    select 1 from public.attendance_corrections c
    join public.attendance_records a on a.id = c.attendance_id
    where c.employee_id = p_employee_id and c.status = 'pending'
      and a.check_in_at >= v_from and a.check_in_at < v_to
  ) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', true, 'message', 'Còn yêu cầu sửa chấm công đang chờ duyệt.'));
  end if;
  if exists (
    select 1 from public.schedule_requests q
    left join public.shifts s on s.id = q.shift_id
    where q.employee_id = p_employee_id and q.status in ('awaiting_peer', 'pending')
      and (
        (q.kind = 'leave' and daterange(q.start_date, q.end_date, '[]') && daterange(p_period_start, v_end, '[]'))
        or (q.kind <> 'leave' and s.work_date between p_period_start and v_end)
      )
  ) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', true, 'message', 'Còn đơn xin phép trong kỳ đang chờ duyệt.'));
  end if;
  if p_end_date is null then
    if v_end >= v_today then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', true, 'message', 'Kỳ lương chưa kết thúc — đây là số tạm tính.'));
    end if;
  elsif p_end_date > v_today then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', true, 'message', 'Ngày chốt sớm không được sau hôm nay.'));
  else
    select count(*) into v_cnt from public.attendance_records a
    where a.employee_id = p_employee_id
      and a.check_in_at >= v_to
      and a.check_in_at < (v_full_end + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
    if v_cnt > 0 then
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', false, 'message',
        format('Có %s lượt chấm công sau ngày %s sẽ KHÔNG được tính vào phiếu này.', v_cnt, to_char(p_end_date, 'DD/MM'))));
    end if;
  end if;

  -- Giờ công theo ngày (chỉ ca đã ra ca) + đi trễ
  for r in
    select (a.check_in_at at time zone 'Asia/Ho_Chi_Minh')::date as d,
           (sum(extract(epoch from (a.check_out_at - a.check_in_at))) / 60)::integer as mins,
           count(*)::integer as n,
           min(a.check_in_at) as first_in
    from public.attendance_records a
    where a.employee_id = p_employee_id
      and a.check_out_at is not null
      and a.check_in_at >= v_from and a.check_in_at < v_to
    group by 1
    order by 1
  loop
    v_days   := v_days + 1;
    v_shifts := v_shifts + r.n;
    v_total  := v_total + r.mins;
    if v_prof.overtime_enabled then
      v_ot := v_ot + greatest(0, r.mins - v_prof.overtime_threshold_minutes);
    end if;

    -- Mốc vào ca: ca đầu ngày theo lịch (đi trễ có phép → giờ đã xin); không có lịch → giờ mặc định
    v_shift := null;
    v_base  := null;
    select * into v_shift from public.shifts s
    where s.employee_id = p_employee_id and s.work_date = r.d and s.status = 'published'
    order by s.start_at limit 1;
    if v_shift.id is not null then
      v_base := v_shift.start_at;
      select q.requested_time into v_req_time from public.schedule_requests q
      where q.shift_id = v_shift.id and q.employee_id = p_employee_id and q.kind = 'late' and q.status = 'approved'
      limit 1;
      if found then
        v_base := private.shift_time_at(v_shift.work_date, v_shift.start_time, v_req_time);
      end if;
    elsif v_emp.default_start_time is not null then
      v_base := (r.d + v_emp.default_start_time) at time zone 'Asia/Ho_Chi_Minh';
    end if;
    if v_base is not null and r.first_in > v_base + make_interval(mins => v_grace) then
      v_late := v_late || to_char(r.d, 'DD/MM');
    end if;
  end loop;

  -- Về sớm (so với ca cuối ngày theo lịch) & nghỉ không phép — chỉ ca đã kết thúc, NV phải chấm công
  if v_emp.requires_attendance then
    for r in
      select s.work_date as d, max(s.end_at) as last_end
      from public.shifts s
      where s.employee_id = p_employee_id and s.status = 'published'
        and s.work_date between p_period_start and v_end and s.end_at < now()
      group by 1
      order by 1
    loop
      select * into v_shift from public.shifts s
      where s.employee_id = p_employee_id and s.work_date = r.d and s.status = 'published' and s.end_at = r.last_end
      limit 1;
      select max(a.check_out_at) into v_out from public.attendance_records a
      where a.employee_id = p_employee_id and a.check_out_at is not null
        and a.check_in_at < v_shift.end_at and a.check_out_at > v_shift.start_at;
      if v_out is not null then
        v_base := v_shift.end_at;
        select q.requested_time into v_req_time from public.schedule_requests q
        where q.shift_id = v_shift.id and q.employee_id = p_employee_id and q.kind = 'early_leave' and q.status = 'approved'
        limit 1;
        if found then
          v_base := private.shift_time_at(v_shift.work_date, v_shift.start_time, v_req_time);
        end if;
        if v_out < v_base - make_interval(mins => v_egrace) then
          v_early := v_early || to_char(r.d, 'DD/MM');
        end if;
      end if;
    end loop;

    select coalesce(array_agg(to_char(s.work_date, 'DD/MM') || ' ' || to_char(s.start_time, 'HH24:MI') order by s.start_at), '{}')
    into v_absent
    from public.shifts s
    where s.employee_id = p_employee_id and s.status = 'published'
      and s.work_date between p_period_start and v_end and s.end_at < now()
      and not exists (
        select 1 from public.attendance_records a
        where a.employee_id = p_employee_id
          and a.check_in_at < s.end_at and coalesce(a.check_out_at, 'infinity'::timestamptz) > s.start_at
      )
      and not exists (
        select 1 from public.schedule_requests q
        where q.employee_id = p_employee_id and q.kind = 'leave' and q.status = 'approved'
          and s.work_date between q.start_date and q.end_date
      );
  end if;

  -- Nghỉ có lương (QTV đánh dấu): mỗi ngày nghỉ trong kỳ mà không đi làm = 1 ngày công
  select count(*) into v_paid
  from public.schedule_requests q
  cross join lateral generate_series(greatest(q.start_date, p_period_start), least(q.end_date, v_end), interval '1 day') g(d)
  where q.employee_id = p_employee_id and q.kind = 'leave' and q.status = 'approved' and q.is_paid
    and not exists (
      select 1 from public.attendance_records a
      where a.employee_id = p_employee_id and a.check_out_at is not null
        and (a.check_in_at at time zone 'Asia/Ho_Chi_Minh')::date = g.d::date
    );

  if v_emp.default_start_time is null and not exists (
    select 1 from public.shifts s
    where s.employee_id = p_employee_id and s.status = 'published' and s.work_date between p_period_start and v_end
  ) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', false, 'message', 'Không có lịch làm và chưa cài giờ vào ca mặc định nên không tính đi trễ.'));
  end if;
  if v_paid > 0 and v_prof.pay_type <> 'fixed' then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', false, 'message',
      format('Có %s ngày nghỉ có lương nhưng nhân viên không hưởng lương cố định — nhập khoản phụ cấp nếu cần.', v_paid)));
  end if;

  -- Lương chính
  if v_prof.pay_type = 'hourly' then
    v_reg := v_total - v_ot;
    v_amount := round(v_reg * v_prof.hourly_rate / 60.0);
    v_lines := v_lines || private.payroll_line('base', 'Lương theo giờ', v_amount, round(v_reg / 60.0, 2), v_prof.hourly_rate,
      case when v_ot > 0 then 'Không gồm giờ tăng ca' end);
  elsif v_prof.pay_type = 'per_shift' then
    v_amount := v_shifts::bigint * v_prof.shift_rate;
    v_lines := v_lines || private.payroll_line('base', 'Lương theo ca', v_amount, v_shifts, v_prof.shift_rate);
  else
    v_amount := least(v_prof.fixed_salary, round(v_prof.fixed_salary::numeric * (v_days + v_paid) / v_prof.standard_days));
    v_lines := v_lines || private.payroll_line('base', 'Lương cố định', v_amount, v_days + v_paid, null,
      format('%s / %s ngày công chuẩn × lương %s', v_days + v_paid, v_prof.standard_days, to_char(v_prof.fixed_salary, 'FM999G999G999G999'))
      || case when v_paid > 0 then format(' (gồm %s ngày nghỉ có lương)', v_paid) else '' end);
  end if;

  -- Tăng ca
  if v_prof.overtime_enabled and v_ot > 0 then
    v_lines := v_lines || private.payroll_line('overtime', 'Tăng ca', round(v_ot * v_prof.overtime_rate / 60.0)::bigint,
      round(v_ot / 60.0, 2), v_prof.overtime_rate, format('Vượt %s giờ/ngày', round(v_prof.overtime_threshold_minutes / 60.0, 1)));
  end if;

  -- Phụ cấp tự động (chỉ khi có đi làm trong kỳ)
  if v_days > 0 and v_prof.allowance_per_period > 0 then
    v_lines := v_lines || private.payroll_line('allowance_period', 'Phụ cấp cố định', v_prof.allowance_per_period);
  end if;
  if v_days > 0 and v_prof.allowance_per_workday > 0 then
    v_lines := v_lines || private.payroll_line('allowance_daily', 'Phụ cấp theo ngày công',
      v_days * v_prof.allowance_per_workday, v_days, v_prof.allowance_per_workday);
  end if;

  -- Phạt đi trễ / về sớm / nghỉ không phép
  if cardinality(v_late) > 0 then
    v_lines := v_lines || private.payroll_line('penalty_late', 'Phạt đi trễ', -(cardinality(v_late) * v_pen_late),
      cardinality(v_late), v_pen_late, array_to_string(v_late, ', '));
  end if;
  if cardinality(v_early) > 0 then
    v_lines := v_lines || private.payroll_line('penalty_early', 'Phạt về sớm không phép', -(cardinality(v_early) * v_pen_early),
      cardinality(v_early), v_pen_early, array_to_string(v_early, ', '));
  end if;
  if cardinality(v_absent) > 0 then
    v_lines := v_lines || private.payroll_line('penalty_absent', 'Phạt nghỉ không phép', -(cardinality(v_absent) * v_pen_abs),
      cardinality(v_absent), v_pen_abs, array_to_string(v_absent, ', '));
  end if;

  -- Phạt checklist: Không đạt
  select count(*), string_agg(distinct to_char(t.task_date, 'DD/MM'), ', ') into v_cnt, v_dates
  from public.task_instances t
  where t.completed_by = p_employee_id and t.status = 'failed'
    and t.task_date between p_period_start and v_end;
  if v_cnt > 0 then
    v_lines := v_lines || private.payroll_line('penalty_task_failed', 'Phạt checklist "Không đạt"', -(v_cnt * v_pen_fail), v_cnt, v_pen_fail, v_dates);
  end if;

  -- Phạt checklist: Làm trễ hạn
  select count(*), string_agg(distinct to_char(t.task_date, 'DD/MM'), ', ') into v_cnt, v_dates
  from public.task_instances t
  where t.completed_by = p_employee_id and t.status = 'done' and t.completed_at > t.due_at
    and t.task_date between p_period_start and v_end;
  if v_cnt > 0 then
    v_lines := v_lines || private.payroll_line('penalty_task_late', 'Phạt checklist làm trễ hạn', -(v_cnt * v_pen_tlat), v_cnt, v_pen_tlat, v_dates);
  end if;

  -- Phạt checklist: Không làm (hết ngày vẫn chưa đánh dấu)
  select count(*), string_agg(distinct to_char(t.task_date, 'DD/MM'), ', ') into v_cnt, v_dates
  from public.task_instances t
  where t.status = 'pending'
    and t.task_date between p_period_start and v_end
    and t.task_date < v_today
    and p_employee_id = case
      when t.backup_employee_id is not null and not private.checked_in_on(t.primary_employee_id, t.task_date)
        then t.backup_employee_id
      else t.primary_employee_id
    end;
  if v_cnt > 0 then
    v_lines := v_lines || private.payroll_line('penalty_task_missed', 'Phạt checklist không làm', -(v_cnt * v_pen_miss), v_cnt, v_pen_miss, v_dates);
  end if;

  -- Điều chỉnh nhập tay
  for r in
    select a.id, a.kind, a.amount, a.reason
    from public.payroll_adjustments a
    where a.employee_id = p_employee_id and a.period_start = p_period_start
    order by a.created_at
  loop
    v_lines := v_lines || jsonb_build_object(
      'code', 'adj_' || r.kind,
      'adjustment_id', r.id,
      'label', case r.kind
        when 'kpi' then 'Thưởng KPI'
        when 'bonus' then 'Thưởng'
        when 'allowance' then 'Phụ cấp khác'
        when 'deduction' then 'Khoản trừ'
        when 'correction_plus' then 'Truy lĩnh'
        when 'correction_minus' then 'Truy thu'
      end,
      'amount', case when r.kind in ('deduction', 'correction_minus') then -r.amount else r.amount end,
      'detail', r.reason
    );
  end loop;

  select coalesce(sum((l ->> 'amount')::bigint) filter (where (l ->> 'amount')::bigint > 0), 0),
         coalesce(-sum((l ->> 'amount')::bigint) filter (where (l ->> 'amount')::bigint < 0), 0)
  into v_gross, v_ded
  from jsonb_array_elements(v_lines) l;
  v_raw := v_gross - v_ded;

  if v_raw < 0 then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', false, 'message', 'Khoản trừ lớn hơn thu nhập (thực nhận âm).'));
  end if;

  return jsonb_build_object(
    'employee_id', v_emp.id,
    'full_name', v_emp.full_name,
    'role', v_emp.role,
    'pay_type', v_prof.pay_type,
    'pay_period', v_prof.pay_period,
    'period_start', p_period_start,
    'period_end', v_end,
    'closed_early', v_end < v_full_end,
    'worked_minutes', v_total,
    'overtime_minutes', v_ot,
    'shifts', v_shifts,
    'work_days', v_days,
    'paid_leave_days', v_paid,
    'late_count', cardinality(v_late),
    'early_count', cardinality(v_early),
    'absent_count', cardinality(v_absent),
    'lines', v_lines,
    'gross_amount', v_gross,
    'deductions_amount', v_ded,
    'raw_net_amount', v_raw,
    'net_amount', (round(v_raw / 1000.0) * 1000)::bigint,
    'warnings', v_warn,
    'can_finalize', not exists (select 1 from jsonb_array_elements(v_warn) w where (w ->> 'blocking')::boolean),
    'finalized', false
  );
end;
$$;

revoke all on function private.compute_payslip(uuid, date, date) from public;

-- ---------------------------------------------------------------------
-- 2. RPC: xem trước & chốt nhận thêm ngày chốt sớm
-- ---------------------------------------------------------------------
drop function public.payroll_preview(uuid, date);
drop function public.finalize_payslip(uuid, date);

create or replace function public.payroll_preview(p_employee_id uuid, p_period_start date, p_end_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_slip public.payslips;
begin
  if not private.can_manage_payroll_for(p_employee_id) then
    raise exception 'Bạn không có quyền xem lương của nhân viên này.' using errcode = '42501';
  end if;
  select * into v_slip from public.payslips p where p.employee_id = p_employee_id and p.period_start = p_period_start;
  if v_slip.id is not null then
    return v_slip.data || jsonb_build_object('finalized', true, 'can_finalize', false, 'payslip_id', v_slip.id, 'finalized_at', v_slip.finalized_at);
  end if;
  return private.compute_payslip(p_employee_id, p_period_start, p_end_date);
end;
$$;

create or replace function public.finalize_payslip(p_employee_id uuid, p_period_start date, p_end_date date default null)
returns public.payslips
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_data   jsonb;
  v_result public.payslips;
begin
  if not private.can_manage_payroll_for(p_employee_id) then
    raise exception 'Bạn không có quyền chốt lương của nhân viên này.' using errcode = '42501';
  end if;
  if exists (select 1 from public.payslips p where p.employee_id = p_employee_id and p.period_start = p_period_start) then
    raise exception 'Kỳ lương này đã được chốt trước đó.' using errcode = 'P0001';
  end if;

  v_data := private.compute_payslip(p_employee_id, p_period_start, p_end_date);
  if v_data is null then
    raise exception 'Nhân viên chưa có hồ sơ lương.' using errcode = 'P0001';
  end if;
  if not (v_data ->> 'can_finalize')::boolean then
    raise exception 'Chưa thể chốt: %', (
      select string_agg(w ->> 'message', ' ') from jsonb_array_elements(v_data -> 'warnings') w where (w ->> 'blocking')::boolean
    ) using errcode = 'P0001';
  end if;

  begin
    insert into public.payslips (
      employee_id, pay_period, period_start, period_end, gross_amount, deductions_amount, net_amount, data, finalized_by
    ) values (
      p_employee_id, (v_data ->> 'pay_period')::public.pay_period, p_period_start, (v_data ->> 'period_end')::date,
      (v_data ->> 'gross_amount')::bigint, (v_data ->> 'deductions_amount')::bigint, (v_data ->> 'net_amount')::bigint,
      v_data - 'can_finalize' - 'finalized', private.current_employee_id()
    )
    returning * into v_result;
  exception
    when unique_violation then
      raise exception 'Kỳ lương này đã được chốt trước đó.' using errcode = 'P0001';
    when exclusion_violation then
      raise exception 'Kỳ này trùng với một kỳ lương đã chốt khác (do đổi kỳ lương tuần/tháng).' using errcode = 'P0001';
  end;

  insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, new_data)
  values ('payslips', v_result.id, 'FINALIZE', (select auth.uid()), private.current_employee_id(), to_jsonb(v_result));

  return v_result;
end;
$$;

revoke all on function public.payroll_preview(uuid, date, date) from public, anon;
revoke all on function public.finalize_payslip(uuid, date, date) from public, anon;
grant execute on function public.payroll_preview(uuid, date, date) to authenticated;
grant execute on function public.finalize_payslip(uuid, date, date) to authenticated;
