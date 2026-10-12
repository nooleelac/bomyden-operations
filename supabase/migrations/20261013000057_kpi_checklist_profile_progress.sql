-- =====================================================================
-- THƯỞNG KPI CHECKLIST: CÀI RIÊNG TỪNG NV + TIẾN ĐỘ TUẦN TRÊN TRANG CHỦ
--   * Hồ sơ lương có mức thưởng / chỉ tiêu % riêng (bỏ trống = dùng mức chung).
--   * private.kpi_checklist_days: việc checklist của NV theo từng ngày (1 nguồn duy nhất cho phiếu lương + trang chủ).
--   * public.my_checklist_week(): tiến độ tuần hiện tại của chính mình (trang chủ).
-- =====================================================================

alter table public.payroll_profiles
  add column kpi_checklist_bonus          bigint,
  add column kpi_checklist_target_percent integer,
  add constraint payroll_profiles_kpi_checklist check (
    (kpi_checklist_bonus is null or kpi_checklist_bonus >= 0)
    and (kpi_checklist_target_percent is null or kpi_checklist_target_percent between 1 and 100)
  );

comment on column public.payroll_profiles.kpi_checklist_bonus is
  'Thưởng KPI checklist riêng mỗi tuần đạt (null = dùng mức chung; 0 = không thưởng cho NV này).';
comment on column public.payroll_profiles.kpi_checklist_target_percent is
  'Chỉ tiêu % checklist riêng (null = dùng mức chung).';

-- ---------------------------------------------------------------------
-- Việc checklist của NV theo ngày: việc NV đã đánh dấu (xong / không đạt) + việc NV phụ trách chưa ai làm
-- (cùng quy tắc "Phạt checklist không làm"); việc đã hủy không tính. ok = "Xong" đúng hạn.
-- ---------------------------------------------------------------------
create or replace function private.kpi_checklist_days(p_employee_id uuid, p_from date, p_to date)
returns table (d date, total integer, ok integer)
language sql
stable
security definer
set search_path = ''
as $$
  select t.task_date,
         count(*)::integer,
         (count(*) filter (where t.status = 'done' and t.completed_at <= t.due_at))::integer
  from public.task_instances t
  where t.task_date between p_from and p_to
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
  group by t.task_date
$$;
revoke all on function private.kpi_checklist_days(uuid, date, date) from public;

-- ---------------------------------------------------------------------
-- Phiếu lương: dùng mức riêng của hồ sơ (nếu có) + hàm chung ở trên
-- ---------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_old text[] := array[
    $q$      cross join lateral (
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
      ) x$q$,
    $q$  v_kpi_detail text[];
$q$,
    $q$  if v_kpi_bonus > 0 then$q$
  ];
  v_new text[] := array[
    $q$      cross join lateral (
        select coalesce(sum(k.total), 0)::integer as total, coalesce(sum(k.ok), 0)::integer as ok
        from private.kpi_checklist_days(p_employee_id, w.ws::date, w.ws::date + 6) k
      ) x$q$,
    $q$  v_kpi_detail text[];
  v_kpi_bonus  bigint;
  v_kpi_target integer;
$q$,
    $q$  v_kpi_bonus  := coalesce(v_prof.kpi_checklist_bonus, v_set.kpi_checklist_bonus);
  v_kpi_target := coalesce(v_prof.kpi_checklist_target_percent, v_set.kpi_checklist_target_percent);
  if v_kpi_bonus > 0 then$q$
  ];
  i integer;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'compute_payslip_base';

  -- Mức chung → biến (mức riêng hồ sơ ghi đè)
  if position('v_set.kpi_checklist_bonus' in v_def) = 0 or position('v_set.kpi_checklist_target_percent' in v_def) = 0 then
    raise exception 'compute_payslip_base: không tìm thấy mức KPI chung cần thay';
  end if;
  v_def := replace(v_def, 'v_set.kpi_checklist_bonus', 'v_kpi_bonus');
  v_def := replace(v_def, 'v_set.kpi_checklist_target_percent', 'v_kpi_target');

  for i in 1 .. array_length(v_old, 1) loop
    if (length(v_def) - length(replace(v_def, v_old[i], ''))) / length(v_old[i]) <> 1 then
      raise exception 'compute_payslip_base: không tìm thấy đúng 1 chỗ cần sửa: %', left(v_old[i], 80);
    end if;
    v_def := replace(v_def, v_old[i], v_new[i]);
  end loop;

  execute v_def;
end $do$;

-- ---------------------------------------------------------------------
-- Tiến độ checklist tuần này của chính mình (trang chủ). Tính đến hết hôm nay:
-- việc hôm nay chưa làm vẫn nằm trong tổng → làm xong thì % tăng.
-- ---------------------------------------------------------------------
create or replace function public.my_checklist_week()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emp   uuid := private.current_employee_id();
  v_today date := private.vn_today();
  v_ws    date := date_trunc('week', private.vn_today()::timestamp)::date;
  v_set   public.payroll_settings;
  v_prof  public.payroll_profiles;
  v_days  jsonb;
begin
  if v_emp is null then
    return null;
  end if;
  select * into v_set from public.payroll_settings limit 1;
  select * into v_prof from public.payroll_profiles pp where pp.employee_id = v_emp;

  select jsonb_agg(jsonb_build_object('date', g.d::date, 'total', coalesce(k.total, 0), 'ok', coalesce(k.ok, 0)) order by g.d)
  into v_days
  from generate_series(v_ws, v_ws + 6, interval '1 day') g(d)
  left join private.kpi_checklist_days(v_emp, v_ws, v_today) k on k.d = g.d::date;

  return jsonb_build_object(
    'week_start', v_ws,
    'today', v_today,
    'days', v_days,
    'total', (select coalesce(sum((x ->> 'total')::integer), 0) from jsonb_array_elements(v_days) x),
    'ok', (select coalesce(sum((x ->> 'ok')::integer), 0) from jsonb_array_elements(v_days) x),
    'bonus', case when v_prof.employee_id is null then 0
                  else coalesce(v_prof.kpi_checklist_bonus, v_set.kpi_checklist_bonus) end,
    'target_percent', coalesce(v_prof.kpi_checklist_target_percent, v_set.kpi_checklist_target_percent)
  );
end;
$$;
revoke all on function public.my_checklist_week() from public, anon;
grant execute on function public.my_checklist_week() to authenticated;

-- ---------------------------------------------------------------------
-- KIỂM THỬ: mức riêng của hồ sơ ghi đè mức chung
-- ---------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_old text := $q$  return r;
end;$q$;
  v_new text := $q$  -- 20. Hồ sơ cài riêng: thưởng 300.000đ, chỉ tiêu 80% → 8/10 đạt (mức chung 90% thì không đạt)
  c := '20 KPI checklist mức riêng';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000,"kpi_checklist_bonus":300000,"kpi_checklist_target_percent":80}');
    for i in 0 .. 7 loop
      perform private.test_task(b, wk + (i % 7), '08:00', '10:00', e, null, false, 'done', e, (wk + (i % 7))::text || ' 09:00');
    end loop;
    perform private.test_task(b, '2026-01-07', '08:00', '10:00', e, null, false, 'failed', e, '2026-01-07 09:00');
    perform private.test_task(b, '2026-01-08', '08:00', '10:00', e, null, false, 'pending');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Thưởng theo mức riêng', private.test_line(v, 'kpi_checklist'), '300000');
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":60000,"kpi_checklist_bonus":0}');
    perform private.test_task(b, wk, '08:00', '10:00', e, null, false, 'done', e, wk::text || ' 09:00');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Mức riêng 0đ → không có dòng', coalesce(private.test_line(v, 'kpi_checklist'), 'không có'), 'không có');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  return r;
end;$q$;
begin
  select pg_get_functiondef('private.payroll_test_suite_kpi()'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'payroll_test_suite_kpi: không tìm thấy đúng 1 chỗ cần sửa';
  end if;
  execute replace(v_def, v_old, v_new);
end $do$;
