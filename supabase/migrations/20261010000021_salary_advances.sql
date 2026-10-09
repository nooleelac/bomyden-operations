-- =====================================================================
-- ỨNG LƯƠNG (10/10/2026)
-- =====================================================================
--   * Mọi NV có hồ sơ lương tự tạo đơn ứng lương cho kỳ lương hiện tại.
--   * Hạn mức = % (QTV cài, mặc định 50%) × thực nhận tạm tính của kỳ tới hiện tại
--     (chưa trừ ứng lương), làm tròn xuống 1.000đ, trừ các đơn đang chờ / đã duyệt.
--   * QTV + Quản lý có quyền lương (NV chi nhánh mình) duyệt / từ chối.
--   * Đã duyệt → tự trừ vào phiếu lương kỳ đó (dòng "Ứng lương").
--   * Còn đơn chờ duyệt trong kỳ → chưa chốt được lương.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CÀI ĐẶT + BẢNG
-- ---------------------------------------------------------------------
alter table public.payroll_settings
  add column advance_max_percent integer not null default 50,
  add constraint payroll_settings_advance_percent check (advance_max_percent between 0 and 100);

create type public.salary_advance_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.salary_advances (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id),
  period_start date not null,
  amount       bigint not null,
  reason       text,
  status       public.salary_advance_status not null default 'pending',
  created_at   timestamptz not null default now(),
  reviewed_by  uuid references public.employees (id),
  reviewed_at  timestamptz,
  review_note  text,
  constraint salary_advances_amount check (amount between 1000 and 1000000000),
  constraint salary_advances_reason check (reason is null or char_length(reason) <= 300),
  constraint salary_advances_note check (review_note is null or char_length(review_note) <= 300)
);
create index salary_advances_emp_period_idx on public.salary_advances (employee_id, period_start);
create index salary_advances_reviewed_by_idx on public.salary_advances (reviewed_by);
create index salary_advances_pending_idx on public.salary_advances (created_at) where status = 'pending';

create trigger salary_advances_audit
after insert or update on public.salary_advances
for each row execute function private.write_audit_log();

create trigger salary_advances_forbid_delete
before delete on public.salary_advances
for each row execute function private.forbid_delete();

alter table public.salary_advances enable row level security;
revoke all on public.salary_advances from anon;
revoke insert, update, delete, truncate on public.salary_advances from authenticated;

create policy "salary_advances_select"
on public.salary_advances for select to authenticated
using (
  employee_id = (select private.current_employee_id())
  or (select private.can_manage_payroll_for(employee_id))
);

-- ---------------------------------------------------------------------
-- 2. TÍNH LƯƠNG: bọc hàm cũ, cộng thêm khấu trừ ứng lương
-- ---------------------------------------------------------------------
alter function private.compute_payslip(uuid, date, date) rename to compute_payslip_base;

create or replace function private.compute_payslip(p_employee_id uuid, p_period_start date, p_end_date date default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v       jsonb;
  v_lines jsonb;
  v_warn  jsonb;
  v_sum   bigint := 0;
  v_raw   bigint;
  v_full  date;
  r       record;
begin
  v := private.compute_payslip_base(p_employee_id, p_period_start, p_end_date);
  if v is null then
    return null;
  end if;
  v_lines := v -> 'lines';
  v_warn  := v -> 'warnings';
  v_full  := private.payroll_period_end((v ->> 'pay_period')::public.pay_period, p_period_start);

  for r in
    select a.id, a.amount, a.reason, a.created_at
    from public.salary_advances a
    where a.employee_id = p_employee_id and a.status = 'approved'
      and a.period_start between p_period_start and v_full
    order by a.created_at
  loop
    v_lines := v_lines || jsonb_build_object(
      'code', 'advance',
      'advance_id', r.id,
      'label', 'Ứng lương',
      'amount', -r.amount,
      'detail', 'Ứng ngày ' || to_char(r.created_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM') || coalesce(' · ' || r.reason, '')
    );
    v_sum := v_sum + r.amount;
  end loop;

  if exists (
    select 1 from public.salary_advances a
    where a.employee_id = p_employee_id and a.status = 'pending'
      and a.period_start between p_period_start and v_full
  ) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', true, 'message', 'Còn đơn ứng lương đang chờ duyệt.'));
  end if;

  if v_sum = 0 and v_warn = v -> 'warnings' then
    return v;
  end if;

  v_raw := (v ->> 'raw_net_amount')::bigint - v_sum;
  if v_raw < 0 and (v ->> 'raw_net_amount')::bigint >= 0 then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', false, 'message', 'Khoản trừ lớn hơn thu nhập (thực nhận âm).'));
  end if;

  return v || jsonb_build_object(
    'lines', v_lines,
    'deductions_amount', (v ->> 'deductions_amount')::bigint + v_sum,
    'raw_net_amount', v_raw,
    'net_amount', (round(v_raw / 1000.0) * 1000)::bigint,
    'advance_amount', v_sum,
    'warnings', v_warn,
    'can_finalize', not exists (select 1 from jsonb_array_elements(v_warn) w where (w ->> 'blocking')::boolean)
  );
end;
$$;
revoke all on function private.compute_payslip(uuid, date, date) from public;
revoke all on function private.compute_payslip_base(uuid, date, date) from public;

-- ---------------------------------------------------------------------
-- 3. HẠN MỨC ỨNG CỦA KỲ HIỆN TẠI
-- ---------------------------------------------------------------------
create or replace function private.advance_quota(p_employee_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_prof   public.payroll_profiles;
  v_today  date := private.vn_today();
  v_start  date;
  v_pct    integer;
  v_earned bigint := 0;
  v_limit  bigint := 0;
  v_used   bigint;
  v_closed boolean;
begin
  select * into v_prof from public.payroll_profiles pp where pp.employee_id = p_employee_id;
  if v_prof.employee_id is null then
    return null;
  end if;
  v_start := case v_prof.pay_period
    when 'weekly' then v_today - (extract(isodow from v_today)::integer - 1)
    else date_trunc('month', v_today)::date
  end;
  select s.advance_max_percent into v_pct from public.payroll_settings s limit 1;
  v_closed := exists (
    select 1 from public.payslips p
    where p.employee_id = p_employee_id and v_today between p.period_start and p.period_end
  );
  if not v_closed and v_pct > 0 then
    v_earned := greatest(0, (private.compute_payslip_base(p_employee_id, v_start, null) ->> 'raw_net_amount')::bigint);
    v_limit := floor(v_earned * v_pct / 100.0 / 1000) * 1000;
  end if;
  select coalesce(sum(a.amount), 0) into v_used
  from public.salary_advances a
  where a.employee_id = p_employee_id and a.period_start = v_start and a.status in ('pending', 'approved');

  return jsonb_build_object(
    'period_start', v_start,
    'period_end', private.payroll_period_end(v_prof.pay_period, v_start),
    'pay_period', v_prof.pay_period,
    'percent', v_pct,
    'earned', v_earned,
    'limit', v_limit,
    'used', v_used,
    'available', greatest(0, v_limit - v_used),
    'closed', v_closed
  );
end;
$$;
revoke all on function private.advance_quota(uuid) from public;

-- ---------------------------------------------------------------------
-- 4. RPC NHÂN VIÊN
-- ---------------------------------------------------------------------
create or replace function public.has_payroll_profile()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.payroll_profiles pp where pp.employee_id = private.current_employee_id())
$$;

create or replace function public.my_salary_advances()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me    uuid := private.current_employee_id();
  v_quota jsonb;
begin
  if v_me is null then
    raise exception 'Bạn chưa đăng nhập.' using errcode = '42501';
  end if;
  v_quota := private.advance_quota(v_me);
  if v_quota is null then
    return jsonb_build_object('has_profile', false);
  end if;
  return jsonb_build_object(
    'has_profile', true,
    'quota', v_quota,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'period_start', a.period_start, 'amount', a.amount, 'reason', a.reason, 'status', a.status,
        'created_at', a.created_at, 'reviewed_at', a.reviewed_at, 'review_note', a.review_note,
        'reviewer_name', rv.full_name
      ) order by a.created_at desc)
      from (
        select * from public.salary_advances x where x.employee_id = v_me order by x.created_at desc limit 30
      ) a
      left join public.employees rv on rv.id = a.reviewed_by
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.request_salary_advance(p_amount bigint, p_reason text default null)
returns public.salary_advances
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_employee_id();
  v_quota  jsonb;
  v_result public.salary_advances;
begin
  if v_me is null then
    raise exception 'Bạn chưa đăng nhập.' using errcode = '42501';
  end if;
  -- Chặn gửi trùng song song
  perform pg_advisory_xact_lock(hashtext('salary_advance:' || v_me::text));

  v_quota := private.advance_quota(v_me);
  if v_quota is null then
    raise exception 'Bạn chưa có hồ sơ lương nên chưa ứng lương được.' using errcode = 'P0001';
  end if;
  if (v_quota ->> 'closed')::boolean then
    raise exception 'Kỳ lương hiện tại của bạn đã chốt.' using errcode = 'P0001';
  end if;
  if (v_quota ->> 'percent')::integer = 0 then
    raise exception 'Quán đang tắt chức năng ứng lương.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < 1000 then
    raise exception 'Số tiền ứng tối thiểu 1.000đ.' using errcode = 'P0001';
  end if;
  if p_amount > (v_quota ->> 'available')::bigint then
    raise exception 'Bạn chỉ có thể ứng tối đa %đ trong kỳ này.',
      to_char((v_quota ->> 'available')::bigint, 'FM999G999G999G999') using errcode = 'P0001';
  end if;

  insert into public.salary_advances (employee_id, period_start, amount, reason)
  values (v_me, (v_quota ->> 'period_start')::date, p_amount, nullif(btrim(coalesce(p_reason, '')), ''))
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.cancel_salary_advance(p_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  update public.salary_advances
  set status = 'cancelled'
  where id = p_id and employee_id = private.current_employee_id() and status = 'pending';
  if not found then
    raise exception 'Không hủy được (đơn đã được xử lý hoặc không phải của bạn).' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. RPC NGƯỜI DUYỆT
-- ---------------------------------------------------------------------
create or replace function public.salary_advance_queue()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.has_payroll_access() then
    raise exception 'Bạn không có quyền xem đơn ứng lương.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'employee_id', a.employee_id, 'full_name', e.full_name, 'period_start', a.period_start,
      'amount', a.amount, 'reason', a.reason, 'status', a.status, 'created_at', a.created_at,
      'reviewed_at', a.reviewed_at, 'review_note', a.review_note, 'reviewer_name', rv.full_name,
      'quota', case when a.status = 'pending' then private.advance_quota(a.employee_id) end
    ) order by (a.status = 'pending') desc, a.created_at desc)
    from public.salary_advances a
    join public.employees e on e.id = a.employee_id
    left join public.employees rv on rv.id = a.reviewed_by
    where private.can_manage_payroll_for(a.employee_id)
      and (a.status = 'pending' or a.created_at > now() - interval '60 days')
  ), '[]'::jsonb);
end;
$$;

create or replace function public.review_salary_advance(p_id uuid, p_approve boolean, p_note text default null)
returns public.salary_advances
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_adv    public.salary_advances;
  v_result public.salary_advances;
begin
  select * into v_adv from public.salary_advances a where a.id = p_id for update;
  if v_adv.id is null or not private.can_manage_payroll_for(v_adv.employee_id) then
    raise exception 'Không tìm thấy đơn hoặc bạn không có quyền duyệt.' using errcode = '42501';
  end if;
  if v_adv.status <> 'pending' then
    raise exception 'Đơn này đã được xử lý.' using errcode = 'P0001';
  end if;
  if p_approve and exists (
    select 1 from public.payslips p
    where p.employee_id = v_adv.employee_id and v_adv.period_start between p.period_start and p.period_end
  ) then
    raise exception 'Kỳ lương của đơn này đã chốt — hãy từ chối và nhập khoản trừ vào kỳ sau.' using errcode = 'P0001';
  end if;

  update public.salary_advances
  set status = case when p_approve then 'approved' else 'rejected' end::public.salary_advance_status,
      reviewed_by = private.current_employee_id(),
      reviewed_at = now(),
      review_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id
  returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.has_payroll_profile() from public, anon;
revoke all on function public.my_salary_advances() from public, anon;
revoke all on function public.request_salary_advance(bigint, text) from public, anon;
revoke all on function public.cancel_salary_advance(uuid) from public, anon;
revoke all on function public.salary_advance_queue() from public, anon;
revoke all on function public.review_salary_advance(uuid, boolean, text) from public, anon;
grant execute on function public.has_payroll_profile() to authenticated;
grant execute on function public.my_salary_advances() to authenticated;
grant execute on function public.request_salary_advance(bigint, text) to authenticated;
grant execute on function public.cancel_salary_advance(uuid) to authenticated;
grant execute on function public.salary_advance_queue() to authenticated;
grant execute on function public.review_salary_advance(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. THÔNG BÁO ĐẨY
-- ---------------------------------------------------------------------
create or replace function private.salary_advances_notify()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_money text := to_char(new.amount, 'FM999G999G999G999') || 'đ';
  v_n     integer := 0;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select full_name into v_name from public.employees where id = new.employee_id;
    -- QTV + QL có quyền lương cùng chi nhánh (QL không duyệt cho QTV / Quản lý khác)
    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    select m.id, 'advance_new', new.id, '💵 Đơn ứng lương: ' || v_name,
           v_money || coalesce(' · Lý do: ' || left(new.reason, 80), ''), '/payroll/advances'
    from public.employees m
    where m.is_active and m.id <> new.employee_id
      and (
        m.role = 'admin'
        or (m.role = 'manager' and m.can_manage_payroll
            and exists (select 1 from public.employees x where x.id = new.employee_id and x.role not in ('admin', 'manager'))
            and exists (
              select 1 from public.employee_branches mb
              join public.employee_branches xb on xb.branch_id = mb.branch_id
              where mb.employee_id = m.id and xb.employee_id = new.employee_id
            ))
      );
    get diagnostics v_n = row_count;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    values (new.employee_id, 'advance_result', new.id,
            case when new.status = 'approved' then '✅ Đơn ứng lương đã được duyệt' else '❌ Đơn ứng lương bị từ chối' end,
            v_money || case when new.status = 'approved' then ' — sẽ trừ vào lương kỳ này' else '' end
              || coalesce(' · ' || new.review_note, ''),
            '/payslips');
    v_n := 1;
  end if;

  if v_n > 0 then
    perform private.push_now();
  end if;
  return null;
end;
$$;

create trigger salary_advances_notify
after insert or update of status on public.salary_advances
for each row execute function private.salary_advances_notify();
