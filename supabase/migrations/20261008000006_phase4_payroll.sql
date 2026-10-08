-- =====================================================================
-- PHASE 4 — BẢNG TÍNH LƯƠNG
-- =====================================================================
-- Nghiệp vụ đã chốt (08/10/2026):
--   * Mỗi NV 1 kiểu lương chính: theo giờ / theo ca / cố định (÷ ngày công chuẩn × ngày đi làm, tối đa = lương).
--   * Tùy chọn tăng ca: phần giờ vượt chuẩn MỖI NGÀY × đơn giá tăng ca.
--   * Phụ cấp: cố định mỗi kỳ, theo ngày công, nhập tay. KPI / thưởng / trừ nhập tay, bắt buộc lý do.
--   * Kỳ lương riêng từng NV: tuần (T2–CN) hoặc tháng.
--   * Phạt trễ: lần vào ca đầu tiên trong ngày muộn hơn giờ vào ca mặc định + phút ân hạn → phạt cố định/lần.
--   * Phạt checklist: Không đạt + Làm trễ (người đánh dấu); Không làm (người chính, hoặc người thay thế nếu
--     người chính nghỉ hôm đó).
--   * Mức phạt chung toàn quán, ghi đè riêng từng NV.
--   * Quyền: QTV; Quản lý được QTV bật quyền lương → chỉ NV chi nhánh mình (không xem lương mình / QL khác).
--   * NV xem phiếu lương của mình nếu QTV bật (chỉ kỳ đã chốt).
--   * Chốt = khóa cứng (lưu ảnh chụp). Sai thì truy thu / truy lĩnh ở kỳ sau.
--   * Tính đến từng đồng, làm tròn số thực nhận đến 1.000đ.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. QUYỀN LƯƠNG CỦA QUẢN LÝ
-- ---------------------------------------------------------------------
alter table public.employees
  add column can_manage_payroll boolean not null default false;

comment on column public.employees.can_manage_payroll is
  'Quản lý được QTV cấp quyền bảng lương (chỉ NV chi nhánh mình). Chỉ QTV thay đổi.';

create or replace function private.employees_payroll_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.role <> 'manager' then
    new.can_manage_payroll := false;
  end if;
  if (select auth.uid()) is not null
     and new.can_manage_payroll is distinct from (case when tg_op = 'UPDATE' then old.can_manage_payroll else false end)
     and not private.is_admin() then
    raise exception 'Chỉ Quản trị viên mới được cấp quyền bảng lương.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger employees_payroll_guard
before insert or update on public.employees
for each row execute function private.employees_payroll_guard();

-- Người thao tác có được xem/sửa/chốt lương của nhân viên này không
create or replace function private.can_manage_payroll_for(p_employee_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me   public.employees;
  v_role public.employee_role;
begin
  select * into v_me from public.employees e where e.auth_user_id = (select auth.uid()) and e.is_active;
  if v_me.id is null then return false; end if;
  if v_me.role = 'admin' then return true; end if;
  if v_me.role <> 'manager' or not v_me.can_manage_payroll or p_employee_id = v_me.id then return false; end if;
  select e.role into v_role from public.employees e where e.id = p_employee_id;
  if v_role is null or v_role in ('admin', 'manager') then return false; end if;
  return private.manages_employee(p_employee_id);
end;
$$;

create or replace function private.has_payroll_access()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.auth_user_id = (select auth.uid()) and e.is_active
      and (e.role = 'admin' or (e.role = 'manager' and e.can_manage_payroll))
  )
$$;

revoke all on function private.can_manage_payroll_for(uuid) from public;
revoke all on function private.has_payroll_access() from public;
grant execute on function private.can_manage_payroll_for(uuid) to authenticated, service_role;
grant execute on function private.has_payroll_access() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. CÀI ĐẶT CHUNG (1 dòng duy nhất)
-- ---------------------------------------------------------------------
create table public.payroll_settings (
  id                        boolean primary key default true,
  late_grace_minutes        integer not null default 5,
  late_penalty              bigint  not null default 0,
  checklist_failed_penalty  bigint  not null default 0,
  checklist_missed_penalty  bigint  not null default 0,
  checklist_late_penalty    bigint  not null default 0,
  updated_at                timestamptz not null default now(),
  updated_by                uuid references public.employees (id),
  constraint payroll_settings_single check (id),
  constraint payroll_settings_values check (
    late_grace_minutes between 0 and 240 and late_penalty >= 0 and checklist_failed_penalty >= 0
    and checklist_missed_penalty >= 0 and checklist_late_penalty >= 0
  )
);
insert into public.payroll_settings (id) values (true);
create index payroll_settings_updated_by_idx on public.payroll_settings (updated_by);

-- ---------------------------------------------------------------------
-- 3. HỒ SƠ LƯƠNG
-- ---------------------------------------------------------------------
create type public.pay_type   as enum ('hourly', 'per_shift', 'fixed');
create type public.pay_period as enum ('weekly', 'monthly');

create table public.payroll_profiles (
  employee_id                uuid primary key references public.employees (id),
  pay_type                   public.pay_type   not null default 'hourly',
  pay_period                 public.pay_period not null default 'monthly',
  hourly_rate                bigint  not null default 0,
  shift_rate                 bigint  not null default 0,
  fixed_salary               bigint  not null default 0,
  standard_days              integer not null default 26,
  overtime_enabled           boolean not null default false,
  overtime_threshold_minutes integer not null default 480,
  overtime_rate              bigint  not null default 0,
  allowance_per_period       bigint  not null default 0,
  allowance_per_workday      bigint  not null default 0,
  -- Ghi đè mức phạt chung (null = dùng mức chung)
  late_grace_minutes         integer,
  late_penalty               bigint,
  checklist_failed_penalty   bigint,
  checklist_missed_penalty   bigint,
  checklist_late_penalty     bigint,
  can_view_payslip           boolean not null default false,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid references public.employees (id),

  constraint payroll_profiles_amounts check (
    hourly_rate >= 0 and shift_rate >= 0 and fixed_salary >= 0 and overtime_rate >= 0
    and allowance_per_period >= 0 and allowance_per_workday >= 0
    and coalesce(late_penalty, 0) >= 0 and coalesce(checklist_failed_penalty, 0) >= 0
    and coalesce(checklist_missed_penalty, 0) >= 0 and coalesce(checklist_late_penalty, 0) >= 0
    and coalesce(late_grace_minutes, 0) between 0 and 240
  ),
  constraint payroll_profiles_standard_days check (standard_days between 1 and 31),
  constraint payroll_profiles_overtime check (overtime_threshold_minutes between 60 and 1440)
);
create index payroll_profiles_updated_by_idx on public.payroll_profiles (updated_by);

create or replace function private.payroll_profiles_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := private.current_employee_id();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if new.employee_id <> old.employee_id then
      raise exception 'Không được đổi nhân viên của hồ sơ lương.' using errcode = 'P0001';
    end if;
  end if;
  -- Chỉ QTV bật/tắt quyền xem phiếu lương
  if (select auth.uid()) is not null and not private.is_admin()
     and new.can_view_payslip is distinct from (case when tg_op = 'UPDATE' then old.can_view_payslip else false end) then
    raise exception 'Chỉ Quản trị viên mới được bật/tắt quyền xem phiếu lương.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger payroll_profiles_guard
before insert or update on public.payroll_profiles
for each row execute function private.payroll_profiles_guard();

create trigger payroll_profiles_audit
after insert or update on public.payroll_profiles
for each row execute function private.write_audit_log();

create trigger payroll_profiles_forbid_delete
before delete on public.payroll_profiles
for each row execute function private.forbid_delete();

create or replace function private.payroll_settings_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := private.current_employee_id();
  return new;
end;
$$;

create trigger payroll_settings_guard
before update on public.payroll_settings
for each row execute function private.payroll_settings_guard();

create or replace function private.payroll_settings_audit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (table_name, action, actor_auth_uid, actor_employee_id, old_data, new_data)
  values ('payroll_settings', 'UPDATE', (select auth.uid()), private.current_employee_id(), to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

create trigger payroll_settings_audit
after update on public.payroll_settings
for each row execute function private.payroll_settings_audit();

-- ---------------------------------------------------------------------
-- 4. KỲ LƯƠNG
-- ---------------------------------------------------------------------
create or replace function private.payroll_period_end(p_period public.pay_period, p_start date)
returns date
language sql immutable
set search_path = ''
as $$
  select case p_period
    when 'weekly' then p_start + 6
    else (date_trunc('month', p_start) + interval '1 month - 1 day')::date
  end
$$;

create or replace function private.payroll_valid_start(p_period public.pay_period, p_start date)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_period
    when 'weekly' then extract(isodow from p_start) = 1
    else extract(day from p_start) = 1
  end
$$;

-- ---------------------------------------------------------------------
-- 5. ĐIỀU CHỈNH NHẬP TAY (KPI, thưởng, phụ cấp, trừ, truy lĩnh, truy thu)
-- ---------------------------------------------------------------------
create type public.payroll_adjustment_kind as enum (
  'kpi', 'bonus', 'allowance', 'deduction', 'correction_plus', 'correction_minus'
);

create table public.payroll_adjustments (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id),
  period_start date not null,
  kind         public.payroll_adjustment_kind not null,
  amount       bigint not null,
  reason       text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.employees (id),
  constraint payroll_adjustments_amount check (amount > 0 and amount <= 1000000000),
  constraint payroll_adjustments_reason check (char_length(btrim(reason)) between 3 and 500)
);
create index payroll_adjustments_emp_period_idx on public.payroll_adjustments (employee_id, period_start);
create index payroll_adjustments_created_by_idx on public.payroll_adjustments (created_by);

-- ---------------------------------------------------------------------
-- 6. PHIẾU LƯƠNG ĐÃ CHỐT (ảnh chụp, khóa cứng)
-- ---------------------------------------------------------------------
create table public.payslips (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees (id),
  pay_period        public.pay_period not null,
  period_start      date not null,
  period_end        date not null,
  gross_amount      bigint not null,
  deductions_amount bigint not null,
  net_amount        bigint not null,
  data              jsonb not null,
  finalized_at      timestamptz not null default now(),
  finalized_by      uuid references public.employees (id),
  constraint payslips_unique_period unique (employee_id, period_start),
  constraint payslips_no_overlap exclude using gist (
    employee_id with =,
    daterange(period_start, period_end, '[]') with &&
  )
);
create index payslips_finalized_by_idx on public.payslips (finalized_by);
create index payslips_employee_idx on public.payslips (employee_id, period_start desc);

create trigger payslips_forbid_delete
before delete on public.payslips
for each row execute function private.forbid_delete();

create trigger payslips_forbid_update
before update on public.payslips
for each row execute function private.forbid_update();

-- Điều chỉnh: kỳ phải hợp lệ, chưa chốt; ghi người tạo
create or replace function private.payroll_adjustments_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_period public.pay_period;
  v_row    public.payroll_adjustments := case when tg_op = 'DELETE' then old else new end;
begin
  if exists (
    select 1 from public.payslips p
    where p.employee_id = v_row.employee_id
      and v_row.period_start between p.period_start and p.period_end
  ) then
    raise exception 'Kỳ lương này đã chốt. Hãy thêm truy thu/truy lĩnh vào kỳ sau.' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Không sửa khoản điều chỉnh. Hãy xóa và nhập lại.' using errcode = 'P0001';
  end if;

  select pp.pay_period into v_period from public.payroll_profiles pp where pp.employee_id = new.employee_id;
  if v_period is null then
    raise exception 'Nhân viên chưa có hồ sơ lương.' using errcode = 'P0001';
  end if;
  if not private.payroll_valid_start(v_period, new.period_start) then
    raise exception 'Ngày bắt đầu kỳ không hợp lệ.' using errcode = 'P0001';
  end if;
  new.reason := btrim(new.reason);
  new.created_at := now();
  new.created_by := private.current_employee_id();
  return new;
end;
$$;

create trigger payroll_adjustments_guard
before insert or update or delete on public.payroll_adjustments
for each row execute function private.payroll_adjustments_guard();

create trigger payroll_adjustments_audit
after insert or delete on public.payroll_adjustments
for each row execute function private.write_audit_log();

-- ---------------------------------------------------------------------
-- 7. TÍNH LƯƠNG (dùng chung cho tạm tính & chốt)
-- ---------------------------------------------------------------------
create or replace function private.payroll_line(
  p_code text, p_label text, p_amount bigint, p_quantity numeric default null,
  p_unit bigint default null, p_detail text default null
)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'code', p_code, 'label', p_label, 'amount', p_amount,
    'quantity', p_quantity, 'unit_amount', p_unit, 'detail', p_detail
  ))
$$;

create or replace function private.compute_payslip(p_employee_id uuid, p_period_start date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_emp      public.employees;
  v_prof     public.payroll_profiles;
  v_set      public.payroll_settings;
  v_end      date;
  v_from     timestamptz;
  v_to       timestamptz;
  v_today    date := private.vn_today();
  v_lines    jsonb := '[]'::jsonb;
  v_warn     jsonb := '[]'::jsonb;
  v_total    integer := 0;
  v_ot       integer := 0;
  v_shifts   integer := 0;
  v_days     integer := 0;
  v_late     text[] := '{}';
  v_grace    integer;
  v_pen_late bigint;
  v_pen_fail bigint;
  v_pen_miss bigint;
  v_pen_tlat bigint;
  v_amount   bigint;
  v_reg      integer;
  v_cnt      integer;
  v_dates    text;
  v_raw      bigint;
  v_gross    bigint;
  v_ded      bigint;
  r          record;
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
  v_end   := private.payroll_period_end(v_prof.pay_period, p_period_start);
  v_from  := p_period_start::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to    := (v_end + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_grace    := coalesce(v_prof.late_grace_minutes, v_set.late_grace_minutes);
  v_pen_late := coalesce(v_prof.late_penalty, v_set.late_penalty);
  v_pen_fail := coalesce(v_prof.checklist_failed_penalty, v_set.checklist_failed_penalty);
  v_pen_miss := coalesce(v_prof.checklist_missed_penalty, v_set.checklist_missed_penalty);
  v_pen_tlat := coalesce(v_prof.checklist_late_penalty, v_set.checklist_late_penalty);

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
  if v_end >= v_today then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', true, 'message', 'Kỳ lương chưa kết thúc — đây là số tạm tính.'));
  end if;
  if v_emp.default_start_time is null then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', false, 'message', 'Chưa cài giờ vào ca mặc định nên không tính đi trễ.'));
  end if;

  -- Giờ công theo ngày (chỉ ca đã ra ca)
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
    if v_emp.default_start_time is not null
       and (r.first_in at time zone 'Asia/Ho_Chi_Minh')::time > v_emp.default_start_time + make_interval(mins => v_grace) then
      v_late := v_late || to_char(r.d, 'DD/MM');
    end if;
  end loop;

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
    v_amount := least(v_prof.fixed_salary, round(v_prof.fixed_salary::numeric * v_days / v_prof.standard_days));
    v_lines := v_lines || private.payroll_line('base', 'Lương cố định', v_amount, v_days, null,
      format('%s / %s ngày công chuẩn × lương %s', v_days, v_prof.standard_days, to_char(v_prof.fixed_salary, 'FM999G999G999G999')));
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

  -- Phạt đi trễ
  if cardinality(v_late) > 0 then
    v_lines := v_lines || private.payroll_line('penalty_late', 'Phạt đi trễ', -(cardinality(v_late) * v_pen_late),
      cardinality(v_late), v_pen_late, array_to_string(v_late, ', '));
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
    'worked_minutes', v_total,
    'overtime_minutes', v_ot,
    'shifts', v_shifts,
    'work_days', v_days,
    'late_count', cardinality(v_late),
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

revoke all on function private.compute_payslip(uuid, date) from public;
revoke all on function private.payroll_line(text, text, bigint, numeric, bigint, text) from public;

-- ---------------------------------------------------------------------
-- 8. RPC CÔNG KHAI
-- ---------------------------------------------------------------------
-- Bảng lương một kỳ: mọi NV trong phạm vi có kỳ lương = p_period.
-- Đã chốt → trả ảnh chụp; chưa chốt → tạm tính.
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
    select e.id, e.full_name, e.is_active, pp.pay_period
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
      if r.is_active then
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

create or replace function public.payroll_preview(p_employee_id uuid, p_period_start date)
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
  return private.compute_payslip(p_employee_id, p_period_start);
end;
$$;

create or replace function public.finalize_payslip(p_employee_id uuid, p_period_start date)
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

  v_data := private.compute_payslip(p_employee_id, p_period_start);
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

revoke all on function public.payroll_overview(public.pay_period, date) from public, anon;
revoke all on function public.payroll_preview(uuid, date) from public, anon;
revoke all on function public.finalize_payslip(uuid, date) from public, anon;
grant execute on function public.payroll_overview(public.pay_period, date) to authenticated;
grant execute on function public.payroll_preview(uuid, date) to authenticated;
grant execute on function public.finalize_payslip(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 9. RLS
-- ---------------------------------------------------------------------
alter table public.payroll_settings    enable row level security;
alter table public.payroll_profiles    enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payslips            enable row level security;

revoke all on public.payroll_settings    from anon;
revoke all on public.payroll_profiles    from anon;
revoke all on public.payroll_adjustments from anon;
revoke all on public.payslips            from anon;

revoke insert, delete, truncate on public.payroll_settings from authenticated;
revoke delete, truncate on public.payroll_profiles from authenticated;
revoke update, truncate on public.payroll_adjustments from authenticated;
revoke insert, update, delete, truncate on public.payslips from authenticated;

create policy "payroll_settings_select"
on public.payroll_settings for select to authenticated
using ((select private.has_payroll_access()));

create policy "payroll_settings_update_admin"
on public.payroll_settings for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy "payroll_profiles_select"
on public.payroll_profiles for select to authenticated
using (
  (select private.can_manage_payroll_for(employee_id))
  or (employee_id = (select private.current_employee_id()) and can_view_payslip)
);

create policy "payroll_profiles_insert"
on public.payroll_profiles for insert to authenticated
with check ((select private.can_manage_payroll_for(employee_id)));

create policy "payroll_profiles_update"
on public.payroll_profiles for update to authenticated
using ((select private.can_manage_payroll_for(employee_id)))
with check ((select private.can_manage_payroll_for(employee_id)));

create policy "payroll_adjustments_select"
on public.payroll_adjustments for select to authenticated
using ((select private.can_manage_payroll_for(employee_id)));

create policy "payroll_adjustments_insert"
on public.payroll_adjustments for insert to authenticated
with check ((select private.can_manage_payroll_for(employee_id)));

create policy "payroll_adjustments_delete"
on public.payroll_adjustments for delete to authenticated
using ((select private.can_manage_payroll_for(employee_id)));

create policy "payslips_select"
on public.payslips for select to authenticated
using (
  (select private.can_manage_payroll_for(employee_id))
  or (
    employee_id = (select private.current_employee_id())
    and exists (
      select 1 from public.payroll_profiles pp
      where pp.employee_id = payslips.employee_id and pp.can_view_payslip
    )
  )
);
