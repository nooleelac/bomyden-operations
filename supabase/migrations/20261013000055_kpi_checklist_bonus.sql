-- =====================================================================
-- THƯỞNG KPI CHECKLIST THEO TUẦN
--   * QTV cài: mức thưởng mỗi tuần đạt (0 = tắt) + chỉ tiêu % việc checklist hoàn thành.
--   * Mỗi tuần T2–CN đã kết thúc, có ngày CN nằm trong kỳ lương (kỳ tháng: tuần kết thúc trong tháng):
--       việc của NV = việc NV đã đánh dấu (xong / không đạt) + việc NV phụ trách mà không ai làm
--       (cùng quy tắc "Phạt checklist không làm"); việc đã hủy không tính.
--       Hoàn thành = "Xong" đúng hạn. Đạt khi số việc hoàn thành ≥ chỉ tiêu % × tổng việc (tuần có ≥ 1 việc).
--   * Tự thêm dòng "Thưởng KPI checklist" vào phiếu lương (số tuần đạt × mức thưởng), chi tiết từng tuần.
--     Tuần chưa đạt vẫn hiện trong chi tiết (dòng 0đ) để nhân viên biết vì sao.
-- =====================================================================

alter table public.payroll_settings
  add column kpi_checklist_bonus          bigint  not null default 0,
  add column kpi_checklist_target_percent integer not null default 100,
  add constraint payroll_settings_kpi_checklist check (
    kpi_checklist_bonus >= 0 and kpi_checklist_target_percent between 1 and 100
  );

comment on column public.payroll_settings.kpi_checklist_bonus is
  'Thưởng KPI checklist cho mỗi tuần (T2–CN) đạt chỉ tiêu; 0 = tắt.';
comment on column public.payroll_settings.kpi_checklist_target_percent is
  'Chỉ tiêu % việc checklist hoàn thành đúng hạn trong tuần để được thưởng KPI.';

-- ---------------------------------------------------------------------
-- TÍNH LƯƠNG: vá private.compute_payslip_base (thay chuỗi có kiểm tra, như migration 54)
-- ---------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_old text[] := array[
    $q$  v_cgrace    integer;
$q$,
    $q$  for r in
    select a.id, a.kind, a.amount, a.reason
    from public.payroll_adjustments a$q$
  ];
  v_new text[] := array[
    $q$  v_cgrace    integer;
  v_kpi_weeks  integer;
  v_kpi_detail text[];
$q$,
    $q$  -- Thưởng KPI checklist: mỗi tuần T2–CN đã kết thúc, CN nằm trong kỳ, đạt chỉ tiêu % việc xong đúng hạn
  if v_set.kpi_checklist_bonus > 0 then
    v_kpi_weeks  := 0;
    v_kpi_detail := '{}';
    for r in
      select w.ws::date as ws, x.total, x.ok
      from generate_series(date_trunc('week', p_period_start::timestamp), v_end::timestamp, interval '7 days') w(ws)
      cross join lateral (
        select count(*)::integer as total,
               (count(*) filter (where t.status = 'done' and t.completed_at <= t.due_at))::integer as ok
        from public.task_instances t
        where t.task_date between w.ws::date and w.ws::date + 6
          and t.status <> 'cancelled'
          and (
            t.completed_by = p_employee_id
            or (t.status = 'pending' and (p_employee_id = case
                  when t.backup_employee_id is not null and not private.checked_in_on(t.primary_employee_id, t.task_date)
                    then t.backup_employee_id
                  else t.primary_employee_id
                end
                or (t.by_shift and private.on_task_shift(t.branch_id, t.start_at, t.due_at, p_employee_id))))
          )
      ) x
      where w.ws::date + 6 between p_period_start and v_end
        and w.ws::date + 6 < v_today
      order by 1
    loop
      if r.total > 0 then
        if r.ok * 100 >= v_set.kpi_checklist_target_percent * r.total then
          v_kpi_weeks := v_kpi_weeks + 1;
        end if;
        v_kpi_detail := v_kpi_detail || format('%s–%s: %s/%s việc (%s%%) %s',
          to_char(r.ws, 'DD/MM'), to_char(r.ws + 6, 'DD/MM'), r.ok, r.total, floor(r.ok * 100.0 / r.total),
          case when r.ok * 100 >= v_set.kpi_checklist_target_percent * r.total then 'đạt' else 'chưa đạt' end);
      end if;
    end loop;
    if cardinality(v_kpi_detail) > 0 then
      v_lines := v_lines || private.payroll_line('kpi_checklist', 'Thưởng KPI checklist',
        v_kpi_weeks * v_set.kpi_checklist_bonus, v_kpi_weeks, v_set.kpi_checklist_bonus,
        format('Chỉ tiêu %s%% việc xong đúng hạn/tuần. ', v_set.kpi_checklist_target_percent)
        || array_to_string(v_kpi_detail, '; '));
    end if;
  end if;

  for r in
    select a.id, a.kind, a.amount, a.reason
    from public.payroll_adjustments a$q$
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
-- KIỂM THỬ (chạy cùng npm run test:payroll). Cài đặt chung được đổi trong giao dịch thử rồi hủy theo.
-- ---------------------------------------------------------------------
create or replace function private.payroll_test_suite_kpi()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r  jsonb := '[]';
  b  uuid;
  e  uuid;
  o  uuid;
  v  jsonb;
  c  text;
  i  integer;
  wk constant date := '2026-01-05';
begin
  update public.payroll_settings set kpi_checklist_bonus = 200000, kpi_checklist_target_percent = 90 where id;
  insert into public.branches (name) values ('Chi nhánh kiểm thử KPI') returning id into b;

  -- 17. Tuần đạt chỉ tiêu: 9/10 xong đúng hạn (1 việc trễ) = 90% → thưởng; việc người khác làm thay không tính
  c := '17 KPI checklist đạt chỉ tiêu';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000}');
    o := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000}');
    for i in 0 .. 8 loop
      perform private.test_task(b, wk + (i % 7), '08:00', '10:00', e, null, false, 'done', e, (wk + (i % 7))::text || ' 09:00');
    end loop;
    perform private.test_task(b, '2026-01-09', '08:00', '10:00', e, null, false, 'done', e, '2026-01-09 11:00');
    perform private.test_task(b, '2026-01-10', '08:00', '10:00', e, null, false, 'failed', o, '2026-01-10 09:00');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Thưởng 1 tuần', private.test_line(v, 'kpi_checklist'), '200000')
           || private.test_eq(c, 'Chi tiết 9/10',
                (select count(*)::text from jsonb_array_elements(v -> 'lines') l
                 where l ->> 'code' = 'kpi_checklist' and l ->> 'detail' like '%05/01–11/01: 9/10 việc (90\%) đạt%'), '1');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 18. Tuần chưa đạt: 8 xong, 1 không đạt, 1 bỏ không làm = 80% → dòng 0đ; NV không có việc → không có dòng
  c := '18 KPI checklist chưa đạt';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000}');
    for i in 0 .. 7 loop
      perform private.test_task(b, wk + (i % 7), '08:00', '10:00', e, null, false, 'done', e, (wk + (i % 7))::text || ' 09:00');
    end loop;
    perform private.test_task(b, '2026-01-07', '08:00', '10:00', e, null, false, 'failed', e, '2026-01-07 09:00');
    perform private.test_task(b, '2026-01-08', '08:00', '10:00', e, null, false, 'pending');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Thưởng 0đ', private.test_line(v, 'kpi_checklist'), '0')
           || private.test_eq(c, 'Ghi chưa đạt',
                (select count(*)::text from jsonb_array_elements(v -> 'lines') l
                 where l ->> 'code' = 'kpi_checklist' and l ->> 'detail' like '%8/10 việc (80\%) chưa đạt%'), '1');
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000}');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Không có việc → không có dòng', coalesce(private.test_line(v, 'kpi_checklist'), 'không có'), 'không có');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 19. Kỳ tháng 01/2026: tính tuần 29/12–04/01 (CN trong tháng), bỏ tuần 26/01–01/02 (CN sang tháng 2)
  c := '19 KPI checklist kỳ tháng';
  begin
    e := private.test_employee(b, '{"pay_type":"fixed","pay_period":"monthly","fixed_salary":2600000}');
    perform private.test_task(b, '2025-12-30', '08:00', '10:00', e, null, false, 'done', e, '2025-12-30 09:00');
    perform private.test_task(b, '2026-01-27', '08:00', '10:00', e, null, false, 'done', e, '2026-01-27 09:00');
    v := private.compute_payslip(e, '2026-01-01');
    r := r || private.test_eq(c, 'Thưởng 1 tuần', private.test_line(v, 'kpi_checklist'), '200000')
           || private.test_eq(c, 'Chỉ tuần 29/12–04/01',
                (select string_agg(l ->> 'detail', '') from jsonb_array_elements(v -> 'lines') l where l ->> 'code' = 'kpi_checklist'),
                'Chỉ tiêu 90% việc xong đúng hạn/tuần. 29/12–04/01: 1/1 việc (100%) đạt');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  return r;
end;
$$;
revoke all on function private.payroll_test_suite_kpi() from public;

-- Các bộ test cũ không phụ thuộc thưởng KPI: tắt KPI trước khi chạy (giao dịch thử bị hủy nên không ảnh hưởng cài đặt thật)
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
    v_results := private.payroll_test_suite() || private.payroll_test_suite_checkout() || private.payroll_test_suite_kpi();
    raise exception 'Hủy dữ liệu kiểm thử' using errcode = 'PTRBK';
  exception when sqlstate 'PTRBK' then
    null;  -- dữ liệu thử đã bị hủy; biến kết quả vẫn giữ
  end;
  return v_results;
end;
$$;
revoke all on function public.service_run_payroll_tests() from public, anon, authenticated;
grant execute on function public.service_run_payroll_tests() to service_role;
