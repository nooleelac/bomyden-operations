-- =====================================================================
-- Làm tròn giờ công theo ca
--  * Vào sớm không quá early_arrival_round_minutes (mặc định 30') → tính từ giờ bắt đầu ca.
--    Vào sớm hơn mốc đó → tính từ giờ vào thực tế (phần dư có thể thành tăng ca).
--  * Ra trước giờ hết ca không quá early_checkout_round_minutes (mặc định 15') → tính đủ đến hết ca.
--  * Ra sau giờ hết ca → tính theo giờ ra thực tế (bỏ mức chặn "hết ca + du di" của migration 054).
--  * Lượt chấm công không khớp ca nào → tính giờ thực tế.
--  * Về sớm chỉ bị phạt khi ra sớm hơn max(early_grace_minutes, early_checkout_round_minutes).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CÀI ĐẶT
-- ---------------------------------------------------------------------
alter table public.payroll_settings
  add column early_arrival_round_minutes integer not null default 30,
  add column early_checkout_round_minutes integer not null default 15,
  add constraint payroll_settings_rounding check (
    early_arrival_round_minutes between 0 and 120
    and early_checkout_round_minutes between 0 and 60
  );

-- ---------------------------------------------------------------------
-- 2. SỐ PHÚT TÍNH CÔNG CỦA 1 LƯỢT CHẤM CÔNG
-- ---------------------------------------------------------------------
create or replace function private.paid_minutes(p_rec public.attendance_records, p_arrive integer, p_leave integer)
returns integer
language sql stable
set search_path = ''
as $$
  select case when p_rec.check_out_at is null then 0 else
    greatest(0, round(extract(epoch from (
      (case when s.id is not null
              and p_rec.check_out_at < s.end_at
              and p_rec.check_out_at >= s.end_at - make_interval(mins => p_leave)
            then s.end_at else p_rec.check_out_at end)
      -
      (case when s.id is not null
              and p_rec.check_in_at < s.start_at
              and p_rec.check_in_at >= s.start_at - make_interval(mins => p_arrive)
            then s.start_at else p_rec.check_in_at end)
    )) / 60))::integer
  end
  from (select 1) x
  left join lateral private.record_shift(p_rec.employee_id, p_rec.check_in_at) s on true
$$;
revoke all on function private.paid_minutes(public.attendance_records, integer, integer) from public;

-- ---------------------------------------------------------------------
-- 3. TÍNH LƯƠNG: thay chuỗi có kiểm tra (mỗi chuỗi cũ phải xuất hiện đúng 1 lần)
-- ---------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_old text[] := array[
    $q$  v_cgrace    integer;
$q$,
    $q$  v_cgrace    := v_set.checkout_grace_minutes;
$q$,
    $q$(sum(extract(epoch from (private.paid_check_out(a, v_emp.auto_checkout_exempt, v_cgrace) - a.check_in_at))) / 60)::integer as mins$q$,
    $q$        if v_out < v_base - make_interval(mins => v_egrace) then$q$,
    $q$      case when v_emp.auto_checkout_exempt
        then format('Ra ca muộn hơn giờ kết thúc ca quá %s phút (miễn tự chốt nên vẫn tính đủ giờ — kiểm tra nếu quên ra ca): %s.', v_cgrace, v_dates)
        else format('Ra ca muộn hơn giờ kết thúc ca quá %s phút — chỉ tính đến hết ca + %s phút (làm thêm thật: duyệt yêu cầu sửa giờ): %s.', v_cgrace, v_cgrace, v_dates)
      end));$q$
  ];
  v_new text[] := array[
    $q$  v_cgrace    integer;
  v_arnd      integer;
  v_lrnd      integer;
$q$,
    $q$  v_cgrace    := v_set.checkout_grace_minutes;
  v_arnd      := v_set.early_arrival_round_minutes;
  v_lrnd      := v_set.early_checkout_round_minutes;
$q$,
    $q$sum(private.paid_minutes(a, v_arnd, v_lrnd))::integer as mins$q$,
    $q$        if v_out < v_base - make_interval(mins => greatest(v_egrace, v_lrnd)) then$q$,
    $q$      format('Ra ca muộn hơn giờ kết thúc ca quá %s phút — tính theo giờ ra thực tế (kiểm tra nếu quên ra ca): %s.', v_cgrace, v_dates)));$q$
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
-- 4. CÀI ĐẶT LÀM TRÒN CHO TRANG CHẤM CÔNG
-- ---------------------------------------------------------------------
create or replace function public.attendance_rounding()
returns table (early_arrival_minutes integer, early_checkout_minutes integer)
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(s.early_arrival_round_minutes, 30), coalesce(s.early_checkout_round_minutes, 15)
  from (select 1) x
  left join public.payroll_settings s on s.id
$$;
revoke all on function public.attendance_rounding() from public, anon;
grant execute on function public.attendance_rounding() to authenticated;

-- ---------------------------------------------------------------------
-- 5. KIỂM THỬ
-- ---------------------------------------------------------------------
-- Cập nhật test 15–16: ra ca muộn giờ tính theo giờ thực tế
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
  wk constant date := '2026-01-05';
begin
  insert into public.branches (name) values ('Chi nhánh kiểm thử ra ca') returning id into b;

  -- 15. Ra ca muộn → tính giờ thực tế (có cảnh báo); tự chốt → phạt quên ra ca
  c := '15 Ra ca muộn + tự chốt + phạt quên ra ca';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000,"forgot_checkout_penalty":20000}');
    perform private.test_shift(e, b, '2026-01-05', '10:00', '14:00');
    perform private.test_shift(e, b, '2026-01-06', '10:00', '14:00');
    perform private.test_shift(e, b, '2026-01-08', '10:00', '14:00');
    perform private.test_att_full(e, b, '2026-01-05 09:55', '2026-01-05 18:00', 'gps');              -- vào sớm 5' → 10:00; 480'
    perform private.test_att_full(e, b, '2026-01-06 10:00', '2026-01-06 18:00', 'wifi', true);       -- 480'
    perform private.test_att_full(e, b, '2026-01-07 10:00', '2026-01-07 18:00', 'gps');              -- không lịch → 480'
    perform private.test_att_full(e, b, '2026-01-08 10:00', '2026-01-08 14:00', 'auto', false, true); -- tự chốt → 240', phạt
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', (480 + 480 + 480 + 240)::text)
           || private.test_eq(c, 'Lương theo giờ', private.test_line(v, 'base'), ((480 + 480 + 480 + 240) * 1000)::text)
           || private.test_eq(c, 'Phạt quên ra ca (1 lần)', private.test_line(v, 'penalty_forgot_checkout'), '-20000')
           || private.test_eq(c, 'Cảnh báo ra ca muộn (không chặn)',
                (select count(*)::text from jsonb_array_elements(v -> 'warnings') w
                 where w ->> 'message' like 'Ra ca muộn hơn giờ kết thúc ca%05/01.' and not (w ->> 'blocking')::boolean), '1')
           || private.test_eq(c, 'Được chốt', v ->> 'can_finalize', 'true');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 16. Nhân viên miễn tự chốt: ra ca muộn vẫn tính đủ giờ (chỉ cảnh báo)
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
                (select count(*)::text from jsonb_array_elements(v -> 'warnings') w where w ->> 'message' like 'Ra ca muộn hơn giờ kết thúc ca%'), '1');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  return r;
end;
$$;
revoke all on function private.payroll_test_suite_checkout() from public;

-- Test làm tròn theo ca 16:00–00:00 (ca qua nửa đêm)
create or replace function private.payroll_test_suite_rounding()
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
  wk constant date := '2026-01-05';
begin
  update public.payroll_settings
  set early_arrival_round_minutes = 30, early_checkout_round_minutes = 15,
      early_grace_minutes = 5, early_leave_penalty = 50000
  where id;
  insert into public.branches (name) values ('Chi nhánh kiểm thử làm tròn') returning id into b;

  -- 20. Đến sớm 15', về sớm 15' → đủ 8h, không phạt về sớm
  c := '20 Làm tròn: sớm 15'' / về sớm 15''';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000,"overtime_enabled":true,"overtime_threshold_minutes":480,"overtime_rate":90000}');
    perform private.test_shift(e, b, '2026-01-05', '16:00', '00:00');
    perform private.test_att_full(e, b, '2026-01-05 15:45', '2026-01-05 23:45', 'gps');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', '480')
           || private.test_eq(c, 'Không tăng ca', v ->> 'overtime_minutes', '0')
           || private.test_eq(c, 'Không phạt về sớm', v ->> 'early_count', '0');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 21. Đến sớm 10', ra 00:15 → 16:00–00:15 = 495', tăng ca 15'
  c := '21 Làm tròn: sớm 10'' / ra muộn 15''';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000,"overtime_enabled":true,"overtime_threshold_minutes":480,"overtime_rate":90000}');
    perform private.test_shift(e, b, '2026-01-05', '16:00', '00:00');
    perform private.test_att_full(e, b, '2026-01-05 15:50', '2026-01-06 00:15', 'gps');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', '495')
           || private.test_eq(c, 'Tăng ca', v ->> 'overtime_minutes', '15');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 22. Đến sớm 40' → tính từ giờ vào thực tế: 15:20–00:00 = 520', tăng ca 40'
  c := '22 Làm tròn: đến sớm quá 30''';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000,"overtime_enabled":true,"overtime_threshold_minutes":480,"overtime_rate":90000}');
    perform private.test_shift(e, b, '2026-01-05', '16:00', '00:00');
    perform private.test_att_full(e, b, '2026-01-05 15:20', '2026-01-06 00:00', 'gps');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', '520')
           || private.test_eq(c, 'Tăng ca', v ->> 'overtime_minutes', '40')
           || private.test_eq(c, 'Tiền tăng ca', private.test_line(v, 'overtime'), '60000');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 23. Đến đúng sớm 30' → vẫn tính từ đầu ca
  c := '23 Làm tròn: đến sớm đúng 30''';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000}');
    perform private.test_shift(e, b, '2026-01-05', '16:00', '00:00');
    perform private.test_att_full(e, b, '2026-01-05 15:30', '2026-01-06 00:00', 'gps');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', '480');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 24. Ra sớm 30' → tính đến giờ ra thực tế + phạt về sớm
  c := '24 Làm tròn: về sớm quá 15''';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000}');
    perform private.test_shift(e, b, '2026-01-05', '16:00', '00:00');
    perform private.test_att_full(e, b, '2026-01-05 16:00', '2026-01-05 23:30', 'gps');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', '450')
           || private.test_eq(c, 'Phạt về sớm', v ->> 'early_count', '1');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 25. Vào trễ 10' → tính từ giờ vào thực tế
  c := '25 Làm tròn: vào trễ';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000}');
    perform private.test_shift(e, b, '2026-01-05', '16:00', '00:00');
    perform private.test_att_full(e, b, '2026-01-05 16:10', '2026-01-06 00:00', 'gps');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', '470')
           || private.test_eq(c, 'Đi trễ', v ->> 'late_count', '1');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 26. Không có ca → giờ thực tế
  c := '26 Làm tròn: không có lịch';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000}');
    perform private.test_att_full(e, b, '2026-01-05 15:45', '2026-01-05 23:45', 'gps');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', '480');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  return r;
end;
$$;
revoke all on function private.payroll_test_suite_rounding() from public;

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
    update public.payroll_settings set kpi_checklist_bonus = 0 where id;
    v_results := private.payroll_test_suite() || private.payroll_test_suite_checkout() || private.payroll_test_suite_kpi()
      || private.payroll_test_suite_leave() || private.payroll_test_suite_rounding();
    raise exception 'Hủy dữ liệu kiểm thử' using errcode = 'PTRBK';
  exception when sqlstate 'PTRBK' then
    null;
  end;
  return v_results;
end;
$$;
revoke all on function public.service_run_payroll_tests() from public, anon, authenticated;
grant execute on function public.service_run_payroll_tests() to service_role;

-- Test 07 (migration 045): ra sớm 10' giờ nằm trong mức làm tròn 15' → đổi thành ra sớm 20' để vẫn bị phạt
do $do$
declare
  v_def text;
  v_old text := $q$'2026-01-05 11:50');$q$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'payroll_test_suite';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'payroll_test_suite: không tìm thấy đúng 1 chỗ cần sửa';
  end if;
  execute replace(v_def, v_old, $q$'2026-01-05 11:40');$q$);
end $do$;
