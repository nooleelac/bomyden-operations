-- =====================================================================
-- QUÊN RA CA: NHẮC + TỰ CHỐT + TÍNH CÔNG THEO LỊCH + PHẠT
--
--   * Hết ca + phút du di (mặc định 15') mà chưa ra ca → nhắc nhân viên (thông báo đẩy).
--   * Hết ca + "tự chốt sau" (mặc định 60') vẫn chưa ra → app ghi giờ ra = GIỜ KẾT THÚC CA theo lịch,
--     đánh dấu quên ra ca, báo nhân viên + QTV + QL chi nhánh. Làm thêm thật → gửi yêu cầu sửa giờ.
--   * Nhân viên "miễn tự chốt" (bếp chính hay làm thêm ngoài lịch): chỉ nhắc, không tự chốt, tính đủ giờ.
--   * Tính lương: tự bấm ra ca muộn hơn hết ca + du di → chỉ tính đến hết ca + du di
--     (trừ NV miễn tự chốt, lượt đã được quản lý sửa / nhập tay, lượt không có lịch).
--   * Phạt quên ra ca: mỗi lượt bị tự chốt hoặc mở quá 16 giờ (không tự chốt được).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CỜ MIỄN TỰ CHỐT CA (chỉ QTV thay đổi)
-- ---------------------------------------------------------------------
alter table public.employees
  add column auto_checkout_exempt boolean not null default false;

comment on column public.employees.auto_checkout_exempt is
  'Không tự chốt ca khi quên ra ca và tính đủ giờ ra ca muộn hơn lịch (ví dụ bếp chính hay làm thêm). Chỉ QTV thay đổi.';

create or replace function private.employees_checkout_exempt_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and new.auto_checkout_exempt is distinct from (case when tg_op = 'UPDATE' then old.auto_checkout_exempt else false end)
     and not private.is_admin() then
    raise exception 'Chỉ Quản trị viên mới được đổi chế độ miễn tự chốt ca.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.employees_checkout_exempt_guard() from public;

create trigger employees_checkout_exempt_guard
  before insert or update of auto_checkout_exempt on public.employees
  for each row execute function private.employees_checkout_exempt_guard();

-- ---------------------------------------------------------------------
-- 2. CHẤM CÔNG: mốc nhắc / quên ra ca
-- ---------------------------------------------------------------------
alter table public.attendance_records
  add column checkout_reminded_at timestamptz,
  add column forgot_checkout_at   timestamptz;

comment on column public.attendance_records.checkout_reminded_at is 'Đã nhắc ra ca (hết ca + phút du di mà chưa ra).';
comment on column public.attendance_records.forgot_checkout_at is
  'Quên ra ca: app tự chốt theo giờ kết thúc ca, hoặc ca mở quá 16 giờ. Tính phạt quên ra ca.';

create index attendance_open_idx on public.attendance_records (check_in_at) where check_out_at is null;

-- ---------------------------------------------------------------------
-- 3. CÀI ĐẶT
-- ---------------------------------------------------------------------
alter table public.payroll_settings
  add column checkout_grace_minutes      integer not null default 15,
  add column auto_checkout_after_minutes integer not null default 60,
  add column forgot_checkout_penalty     bigint  not null default 0,
  add constraint payroll_settings_checkout check (
    checkout_grace_minutes between 0 and 240
    and auto_checkout_after_minutes between 15 and 720
    and auto_checkout_after_minutes > checkout_grace_minutes
    and forgot_checkout_penalty >= 0
  );

comment on column public.payroll_settings.checkout_grace_minutes is
  'Phút du di sau giờ kết thúc ca: quá mốc này → nhắc ra ca; tự bấm ra muộn hơn → chỉ tính lương đến mốc này.';
comment on column public.payroll_settings.auto_checkout_after_minutes is
  'Hết ca bao nhiêu phút mà chưa ra ca thì app tự chốt (giờ ra = giờ kết thúc ca).';

alter table public.payroll_profiles
  add column forgot_checkout_penalty bigint,
  add constraint payroll_profiles_forgot_penalty check (forgot_checkout_penalty is null or forgot_checkout_penalty >= 0);

-- ---------------------------------------------------------------------
-- 4. CA THEO LỊCH CỦA 1 LƯỢT CHẤM CÔNG
--    Ca đã công bố sớm nhất chưa kết thúc lúc vào ca, bắt đầu không quá 3 giờ sau giờ vào
--    (vào sớm vẫn khớp ca; ca chia đôi trong ngày → khớp ca đang làm).
-- ---------------------------------------------------------------------
create or replace function private.record_shift(p_employee_id uuid, p_check_in_at timestamptz)
returns public.shifts
language sql stable
set search_path = ''
as $$
  select s.* from public.shifts s
  where s.employee_id = p_employee_id and s.status = 'published'
    and s.end_at > p_check_in_at
    and s.start_at < p_check_in_at + interval '3 hours'
  order by s.start_at
  limit 1
$$;
revoke all on function private.record_shift(uuid, timestamptz) from public;

-- Giờ ra ca được tính lương
create or replace function private.paid_check_out(p_rec public.attendance_records, p_exempt boolean, p_grace integer)
returns timestamptz
language sql stable
set search_path = ''
as $$
  select case
    when p_exempt or p_rec.is_corrected or p_rec.check_out_method not in ('gps', 'wifi') then p_rec.check_out_at
    else least(
      p_rec.check_out_at,
      coalesce((private.record_shift(p_rec.employee_id, p_rec.check_in_at)).end_at + make_interval(mins => p_grace), p_rec.check_out_at)
    )
  end
$$;
revoke all on function private.paid_check_out(public.attendance_records, boolean, integer) from public;

-- ---------------------------------------------------------------------
-- 5. JOB MỖI 5 PHÚT: nhắc ra ca, tự chốt, đánh dấu quên ra ca
-- ---------------------------------------------------------------------
create or replace function private.run_checkout_jobs()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_set   public.payroll_settings;
  v_count integer := 0;
  v_end   text;
  r       record;
begin
  select * into v_set from public.payroll_settings limit 1;

  -- 5a. Nhắc ra ca (1 lần / lượt; quá mốc tự chốt thì thôi nhắc)
  for r in
    select a.id, a.employee_id, e.auto_checkout_exempt, s.end_at
    from public.attendance_records a
    join public.employees e on e.id = a.employee_id
    cross join lateral private.record_shift(a.employee_id, a.check_in_at) s
    where a.check_out_at is null and a.checkout_reminded_at is null and a.forgot_checkout_at is null
      and s.id is not null
      and now() > s.end_at + make_interval(mins => v_set.checkout_grace_minutes)
      and (e.auto_checkout_exempt or now() < s.end_at + make_interval(mins => v_set.auto_checkout_after_minutes))
  loop
    update public.attendance_records set checkout_reminded_at = now() where id = r.id;
    v_end := to_char(r.end_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI');
    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    values (r.employee_id, 'checkout_reminder', r.id, '⏰ Bạn chưa bấm ra ca',
      'Ca của bạn kết thúc lúc ' || v_end || '. Nếu đã về, hãy bấm "Ra ca" ngay.'
        || case when r.auto_checkout_exempt then ''
           else ' Sau ' || to_char((r.end_at + make_interval(mins => v_set.auto_checkout_after_minutes)) at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI')
                || ' app sẽ tự chốt ca lúc ' || v_end || ' và tính 1 lần quên ra ca.' end,
      '/attendance');
    v_count := v_count + 1;
  end loop;

  -- 5b. Tự chốt (trừ NV miễn tự chốt): giờ ra = giờ kết thúc ca
  for r in
    select a.id, a.employee_id, a.branch_id, e.full_name, s.end_at, b.name as branch_name
    from public.attendance_records a
    join public.employees e on e.id = a.employee_id
    join public.branches b on b.id = a.branch_id
    cross join lateral private.record_shift(a.employee_id, a.check_in_at) s
    where a.check_out_at is null and not e.auto_checkout_exempt
      and s.id is not null
      and now() >= s.end_at + make_interval(mins => v_set.auto_checkout_after_minutes)
  loop
    update public.attendance_records set
      check_out_at       = r.end_at,
      check_out_method   = 'auto',
      forgot_checkout_at = coalesce(forgot_checkout_at, now()),
      updated_at         = now()
    where id = r.id and check_out_at is null;
    if not found then
      continue;
    end if;
    v_end := to_char(r.end_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM');

    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    values (r.employee_id, 'auto_checkout', r.id, '🔒 Ca đã được tự chốt',
      'Bạn quên bấm ra ca nên app đã chốt ca lúc ' || v_end || ' (giờ kết thúc ca) và tính 1 lần quên ra ca. '
        || 'Nếu bạn làm thêm sau giờ đó, hãy gửi yêu cầu sửa giờ.',
      '/attendance');

    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    select m.id, 'auto_checkout', r.id, '🔒 Tự chốt ca: ' || r.full_name,
      'Quên bấm ra ca — app đã chốt lúc ' || v_end || ' · ' || r.branch_name || '.',
      '/attendance/manage'
    from public.employees m
    where m.is_active and m.id <> r.employee_id and (
      m.role = 'admin'
      or (m.role = 'manager' and exists (
        select 1 from public.employee_branches eb where eb.employee_id = m.id and eb.branch_id = r.branch_id
      ))
    );
    v_count := v_count + 1;
  end loop;

  -- 5c. Ca mở quá 16 giờ (miễn tự chốt / không có lịch) → đánh dấu quên ra ca
  update public.attendance_records set forgot_checkout_at = now()
  where check_out_at is null and forgot_checkout_at is null and check_in_at < now() - interval '16 hours';

  if v_count > 0 then
    perform private.push_now();
  end if;
end;
$$;
revoke all on function private.run_checkout_jobs() from public;

select cron.schedule('bomyden-checkout-jobs', '*/5 * * * *', 'select private.run_checkout_jobs()');

-- ---------------------------------------------------------------------
-- 6. TÍNH LƯƠNG: giờ ra tính lương theo lịch + cảnh báo ra ca muộn + phạt quên ra ca
-- ---------------------------------------------------------------------
-- Sửa đúng các chỗ trong private.compute_payslip_base (hàm rất dài, đã được vá ở migration trước)
-- bằng cách thay chuỗi có kiểm tra: mỗi chuỗi cũ phải xuất hiện đúng 1 lần.
do $do$
declare
  v_def text;
  v_old text[] := array[
    $q$  v_pen_tlat  bigint;
$q$,
    $q$  v_pen_tlat  := coalesce(v_prof.checklist_late_penalty, v_set.checklist_late_penalty);
$q$,
    $q$(sum(extract(epoch from (a.check_out_at - a.check_in_at))) / 60)::integer as mins$q$,
    $q$  select count(*) into v_paid
$q$,
    $q$  select count(*), string_agg(distinct to_char(t.task_date, 'DD/MM'), ', ') into v_cnt, v_dates
  from public.task_instances t
  where t.completed_by = p_employee_id and t.status = 'failed'$q$
  ];
  v_new text[] := array[
    $q$  v_pen_tlat  bigint;
  v_pen_forgot bigint;
  v_cgrace    integer;
$q$,
    $q$  v_pen_tlat  := coalesce(v_prof.checklist_late_penalty, v_set.checklist_late_penalty);
  v_pen_forgot := coalesce(v_prof.forgot_checkout_penalty, v_set.forgot_checkout_penalty);
  v_cgrace    := v_set.checkout_grace_minutes;
$q$,
    $q$(sum(extract(epoch from (private.paid_check_out(a, v_emp.auto_checkout_exempt, v_cgrace) - a.check_in_at))) / 60)::integer as mins$q$,
    $q$  -- Ra ca muộn hơn lịch quá phút du di (tự bấm, chưa sửa)
  select string_agg(to_char(x.d, 'DD/MM'), ', ' order by x.d) into v_dates
  from (
    select distinct (a.check_in_at at time zone 'Asia/Ho_Chi_Minh')::date as d
    from public.attendance_records a
    where a.employee_id = p_employee_id and a.check_out_at is not null
      and a.check_in_at >= v_from and a.check_in_at < v_to
      and a.check_out_method in ('gps', 'wifi') and not a.is_corrected
      and a.check_out_at > (private.record_shift(a.employee_id, a.check_in_at)).end_at + make_interval(mins => v_cgrace)
  ) x;
  if v_dates is not null then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', false, 'message',
      case when v_emp.auto_checkout_exempt
        then format('Ra ca muộn hơn giờ kết thúc ca quá %s phút (miễn tự chốt nên vẫn tính đủ giờ — kiểm tra nếu quên ra ca): %s.', v_cgrace, v_dates)
        else format('Ra ca muộn hơn giờ kết thúc ca quá %s phút — chỉ tính đến hết ca + %s phút (làm thêm thật: duyệt yêu cầu sửa giờ): %s.', v_cgrace, v_cgrace, v_dates)
      end));
  end if;

  select count(*) into v_paid
$q$,
    $q$  -- Phạt quên ra ca (app tự chốt / ca mở quá 16 giờ)
  select count(*), string_agg(to_char(a.check_in_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM'), ', ' order by a.check_in_at)
  into v_cnt, v_dates
  from public.attendance_records a
  where a.employee_id = p_employee_id and a.forgot_checkout_at is not null
    and a.check_in_at >= v_from and a.check_in_at < v_to;
  if v_cnt > 0 then
    v_lines := v_lines || private.payroll_line('penalty_forgot_checkout', 'Phạt quên ra ca', -(v_cnt * v_pen_forgot), v_cnt, v_pen_forgot, v_dates);
  end if;

  select count(*), string_agg(distinct to_char(t.task_date, 'DD/MM'), ', ') into v_cnt, v_dates
  from public.task_instances t
  where t.completed_by = p_employee_id and t.status = 'failed'$q$
  ];
  i integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'compute_payslip_base';

  for i in 1 .. array_length(v_old, 1) loop
    if (length(v_def) - length(replace(v_def, v_old[i], ''))) / length(v_old[i]) <> 1 then
      raise exception 'compute_payslip_base: không tìm thấy đúng 1 chỗ cần sửa: %', left(v_old[i], 80);
    end if;
    v_def := replace(v_def, v_old[i], v_new[i]);
  end loop;

  execute v_def;
end $do$;

-- ---------------------------------------------------------------------
-- 7. KIỂM THỬ: giờ ra tính lương theo lịch + phạt quên ra ca (chạy cùng npm run test:payroll)
-- ---------------------------------------------------------------------
create or replace function private.test_att_full(
  p_employee_id uuid, p_branch_id uuid, p_in text, p_out text,
  p_method public.attendance_method, p_corrected boolean default false, p_forgot boolean default false
)
returns void
language sql
set search_path = ''
as $$
  insert into public.attendance_records (employee_id, branch_id, check_in_at, check_in_method, check_out_at, check_out_method, is_corrected, forgot_checkout_at)
  values (p_employee_id, p_branch_id, private.test_ts(p_in), 'gps', private.test_ts(p_out), p_method, p_corrected,
          case when p_forgot then now() end)
$$;
revoke all on function private.test_att_full(uuid, uuid, text, text, public.attendance_method, boolean, boolean) from public;

create or replace function private.payroll_test_suite_checkout()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r  jsonb := '[]';
  b  uuid;
  e  uuid;
  v  jsonb;
  c  text;
  g  integer;
  wk constant date := '2026-01-05';
begin
  select checkout_grace_minutes into g from public.payroll_settings limit 1;
  insert into public.branches (name) values ('Chi nhánh kiểm thử ra ca') returning id into b;

  -- 15. Tự bấm ra ca muộn hơn lịch → chỉ tính đến hết ca + du di; lượt đã sửa / không có lịch → tính đủ; phạt quên ra ca
  c := '15 Ra ca muộn + tự chốt + phạt quên ra ca';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000,"forgot_checkout_penalty":20000}');
    perform private.test_shift(e, b, '2026-01-05', '10:00', '14:00');
    perform private.test_shift(e, b, '2026-01-06', '10:00', '14:00');
    perform private.test_shift(e, b, '2026-01-08', '10:00', '14:00');
    perform private.test_att_full(e, b, '2026-01-05 09:55', '2026-01-05 18:00', 'gps');              -- cắt còn 14:00 + du di
    perform private.test_att_full(e, b, '2026-01-06 10:00', '2026-01-06 18:00', 'wifi', true);       -- QL đã sửa → 480'
    perform private.test_att_full(e, b, '2026-01-07 10:00', '2026-01-07 18:00', 'gps');              -- không lịch → 480'
    perform private.test_att_full(e, b, '2026-01-08 10:00', '2026-01-08 14:00', 'auto', false, true); -- tự chốt → 240', phạt
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', (245 + g + 480 + 480 + 240)::text)
           || private.test_eq(c, 'Lương theo giờ', private.test_line(v, 'base'), ((245 + g + 480 + 480 + 240) * 1000)::text)
           || private.test_eq(c, 'Phạt quên ra ca (1 lần)', private.test_line(v, 'penalty_forgot_checkout'), '-20000')
           || private.test_eq(c, 'Cảnh báo ra ca muộn (không chặn)',
                (select count(*)::text from jsonb_array_elements(v -> 'warnings') w
                 where w ->> 'message' like 'Ra ca muộn hơn giờ kết thúc ca%05/01.' and not (w ->> 'blocking')::boolean), '1')
           || private.test_eq(c, 'Được chốt', v ->> 'can_finalize', 'true');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 16. Nhân viên miễn tự chốt: ra ca muộn hơn lịch vẫn tính đủ giờ (chỉ cảnh báo)
  c := '16 Miễn tự chốt tính đủ giờ';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000}');
    update public.employees set auto_checkout_exempt = true where id = e;
    perform private.test_shift(e, b, '2026-01-05', '10:30', '19:30');
    perform private.test_att_full(e, b, '2026-01-05 10:30', '2026-01-05 22:00', 'gps');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm (đủ 690'')', v ->> 'worked_minutes', '690')
           || private.test_eq(c, 'Không phạt quên ra ca', coalesce(private.test_line(v, 'penalty_forgot_checkout'), 'không có'), 'không có')
           || private.test_eq(c, 'Có cảnh báo kiểm tra',
                (select count(*)::text from jsonb_array_elements(v -> 'warnings') w where w ->> 'message' like '%miễn tự chốt%'), '1');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  return r;
end;
$$;
revoke all on function private.payroll_test_suite_checkout() from public;

create or replace function public.service_run_payroll_tests()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_results jsonb := '[]'::jsonb;
begin
  begin
    v_results := private.payroll_test_suite() || private.payroll_test_suite_checkout();
    raise exception 'Hủy dữ liệu kiểm thử' using errcode = 'PTRBK';
  exception when sqlstate 'PTRBK' then
    null;  -- dữ liệu thử đã bị hủy; biến kết quả vẫn giữ
  end;
  return v_results;
end;
$$;
revoke all on function public.service_run_payroll_tests() from public, anon, authenticated;
grant execute on function public.service_run_payroll_tests() to service_role;
