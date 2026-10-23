-- =====================================================================
-- CHECKLIST KHI NHÂN VIÊN NGHỈ PHÉP (23/10/2026)
-- =====================================================================
-- Nghiệp vụ đã chốt:
--   * Ngày có đơn nghỉ ĐÃ DUYỆT: người nghỉ không nhận việc, không bị nhắc, không bị phạt
--     "không làm" và không bị tính vào KPI checklist.
--   * Việc giao đích danh: chuyển hết cho người thay → coi như việc chính của người thay
--     (bỏ sót bị phạt "không làm", làm trễ bị phạt "làm trễ hạn" như việc của chính họ).
--     Không có người thay (hoặc người thay cũng nghỉ) → không phạt ai, báo QL/QTV giao người làm.
--   * Việc giao theo ca: người nghỉ không còn tính là "trong ca"; những người còn lại trong ca nhận việc.
--   * Quy tắc cũ giữ nguyên: người chính chưa chấm công trong ngày → người thay nhận việc.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. AI ĐANG NGHỈ PHÉP / AI PHỤ TRÁCH VIỆC ĐÍCH DANH
-- ---------------------------------------------------------------------
create or replace function private.on_leave(p_employee_id uuid, p_date date)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.schedule_requests q
    where q.employee_id = p_employee_id
      and q.kind = 'leave'
      and q.status = 'approved'
      and p_date between q.start_date and q.end_date
  )
$$;

-- Người phải làm việc giao đích danh trong ngày (null = không có ai: người chính nghỉ, không có người thay)
create or replace function private.task_assignee(p_primary uuid, p_backup uuid, p_date date)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select case
    when p_primary is null then null
    when private.on_leave(p_primary, p_date) then
      case when p_backup is not null and not private.on_leave(p_backup, p_date) then p_backup end
    when p_backup is not null and not private.checked_in_on(p_primary, p_date) and not private.on_leave(p_backup, p_date)
      then p_backup
    else p_primary
  end
$$;

revoke all on function private.on_leave(uuid, date) from public;
grant execute on function private.on_leave(uuid, date) to authenticated, service_role;
revoke all on function private.task_assignee(uuid, uuid, date) from public;
grant execute on function private.task_assignee(uuid, uuid, date) to authenticated, service_role;

create index if not exists schedule_requests_leave_idx
on public.schedule_requests (employee_id, start_date, end_date)
where kind = 'leave' and status = 'approved';

-- ---------------------------------------------------------------------
-- 2. VIỆC THEO CA: NGƯỜI NGHỈ KHÔNG TÍNH LÀ TRONG CA
-- ---------------------------------------------------------------------
create or replace function private.on_task_shift(p_branch_id uuid, p_start timestamptz, p_due timestamptz, p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shifts s
    where s.employee_id = p_employee_id
      and s.branch_id = p_branch_id
      and s.status = 'published'
      and s.start_at < p_due
      and s.end_at > p_start
      and not private.on_leave(s.employee_id, s.work_date)
  )
$$;

create or replace function private.task_shift_staff(p_branch_id uuid, p_start timestamptz, p_due timestamptz)
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct s.employee_id
  from public.shifts s
  join public.employees e on e.id = s.employee_id and e.is_active
  where s.branch_id = p_branch_id
    and s.status = 'published'
    and s.start_at < p_due
    and s.end_at > p_start
    and not private.on_leave(s.employee_id, s.work_date)
$$;

-- ---------------------------------------------------------------------
-- 3. KPI CHECKLIST
-- ---------------------------------------------------------------------
create or replace function private.kpi_checklist_days(p_employee_id uuid, p_from date, p_to date)
returns table(d date, total integer, ok integer)
language sql stable security definer
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
      or (t.status = 'pending' and (
            p_employee_id = private.task_assignee(t.primary_employee_id, t.backup_employee_id, t.task_date)
            or (t.by_shift and private.on_task_shift(t.branch_id, t.start_at, t.due_at, p_employee_id))))
    )
  group by t.task_date
$$;

-- ---------------------------------------------------------------------
-- 4. NHẮC VIỆC
-- ---------------------------------------------------------------------
create or replace function private.enqueue_task_notifications()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today  date := private.vn_today();
  v_before interval := interval '30 minutes';
  v_window interval := interval '6 hours';
  v_total  integer := 0;
  v_count  integer;
begin
  perform public.ensure_task_instances(v_today);

  -- Người phụ trách: người chính / người thay (theo private.task_assignee); việc theo ca: mọi người trong ca (trừ người nghỉ)
  create temp table if not exists tmp_task_recipients (task_id uuid, employee_id uuid, stage text) on commit drop;
  truncate tmp_task_recipients;

  insert into tmp_task_recipients (task_id, employee_id, stage)
  select t.id, r.employee_id, case when now() >= t.due_at then 'overdue' else 'due_soon' end
  from public.task_instances t
  cross join lateral (
    select private.task_assignee(t.primary_employee_id, t.backup_employee_id, t.task_date) as employee_id
    where not t.by_shift
    union
    select s.staff_id from private.task_shift_staff(t.branch_id, t.start_at, t.due_at) s(staff_id)
    where t.by_shift
  ) r
  join public.employees e on e.id = r.employee_id and e.is_active
  where t.status = 'pending'
    and t.task_date between v_today - 1 and v_today
    and now() >= greatest(t.start_at, t.due_at - v_before)
    and now() < t.due_at + v_window;

  insert into public.notifications (employee_id, kind, task_instance_id, title, body, url)
  select r.employee_id,
         case r.stage when 'overdue' then 'task_overdue'::public.notification_kind else 'task_due_soon'::public.notification_kind end,
         t.id,
         case r.stage when 'overdue' then '🔴 Quá hạn: ' else '⏰ Sắp hết hạn: ' end || t.title,
         'Hạn chót ' || to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || ' · ' || b.name
           || case r.stage when 'overdue' then ' — làm ngay hoặc báo "Không đạt" kèm lý do.' else '' end,
         '/checklist'
  from tmp_task_recipients r
  join public.task_instances t on t.id = r.task_id
  join public.branches b on b.id = t.branch_id
  on conflict (employee_id, kind, task_instance_id) do nothing;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  -- Quá hạn → báo Quản lý chi nhánh + Quản trị viên (trừ chính người phụ trách)
  insert into public.notifications (employee_id, kind, task_instance_id, title, body, url)
  select m.id, 'task_overdue_report', t.id,
         '🔴 Việc quá hạn: ' || t.title,
         case
           when t.by_shift then coalesce(
             (select 'Ca: ' || string_agg(se.full_name, ', ')
              from private.task_shift_staff(t.branch_id, t.start_at, t.due_at) s(staff_id)
              join public.employees se on se.id = s.staff_id),
             'Không có người trong ca')
           else coalesce(a.full_name, p.full_name || ' nghỉ phép, không có người thay')
         end || ' · ' || b.name || ' · hạn ' || to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'),
         '/checklist/manage?date=' || t.task_date
  from public.task_instances t
  join public.branches b on b.id = t.branch_id
  left join public.employees p on p.id = t.primary_employee_id
  left join public.employees a on a.id = private.task_assignee(t.primary_employee_id, t.backup_employee_id, t.task_date)
  join public.employees m on m.is_active and (
    m.role = 'admin'
    or (m.role = 'manager' and exists (
      select 1 from public.employee_branches eb where eb.employee_id = m.id and eb.branch_id = t.branch_id
    ))
  )
  where t.status = 'pending'
    and t.task_date between v_today - 1 and v_today
    and now() >= t.due_at and now() < t.due_at + v_window
    and not exists (select 1 from tmp_task_recipients r where r.task_id = t.id and r.employee_id = m.id)
  on conflict (employee_id, kind, task_instance_id) do nothing;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  -- Không có ai làm (việc theo ca không ai trong ca / người chính nghỉ phép, không có người thay)
  -- → báo QL + QTV từ 30 phút trước giờ bắt đầu
  insert into public.notifications (employee_id, kind, task_instance_id, title, body, url)
  select m.id, 'task_no_staff', t.id,
         case when t.by_shift then '⚠️ Không có người trong ca: ' else '⚠️ Không có người làm thay: ' end || t.title,
         case when t.by_shift then '' else p.full_name || ' nghỉ phép · ' end
           || to_char(t.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || '–'
           || to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || ' · ' || b.name
           || ' — hãy xếp ca hoặc giao người làm.',
         '/checklist/manage'
  from public.task_instances t
  join public.branches b on b.id = t.branch_id
  left join public.employees p on p.id = t.primary_employee_id
  join public.employees m on m.is_active and (
    m.role = 'admin'
    or (m.role = 'manager' and exists (
      select 1 from public.employee_branches eb where eb.employee_id = m.id and eb.branch_id = t.branch_id
    ))
  )
  where t.status = 'pending'
    and t.task_date = v_today
    and now() >= t.start_at - v_before and now() < t.due_at
    and case
      when t.by_shift then not exists (select 1 from private.task_shift_staff(t.branch_id, t.start_at, t.due_at))
      else private.task_assignee(t.primary_employee_id, t.backup_employee_id, t.task_date) is null
    end
  on conflict (employee_id, kind, task_instance_id) do nothing;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. ĐÁNH DẤU + TÍNH LƯƠNG: dùng chung private.task_assignee
-- ---------------------------------------------------------------------
-- Sửa đúng 1 chỗ trong mỗi hàm dài bằng cách thay chuỗi có kiểm tra.
do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  -- Người thay chỉ đánh dấu được khi việc đang thuộc về họ
  select pg_get_functiondef('public.complete_task_instance(uuid, uuid, public.task_status, text, text, boolean)'::regprocedure) into v_def;
  v_old := E'if private.checked_in_on(v_inst.primary_employee_id, v_inst.task_date) then';
  v_new := E'if private.task_assignee(v_inst.primary_employee_id, v_inst.backup_employee_id, v_inst.task_date) is distinct from v_emp.id then';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'complete_task_instance: không tìm thấy đúng 1 chỗ cần sửa.';
  end if;
  execute replace(v_def, v_old, v_new);

  -- Phạt "không làm": người phụ trách thực tế (người nghỉ phép không bị phạt)
  select pg_get_functiondef('private.compute_payslip_base'::regproc) into v_def;
  v_old := E'and (p_employee_id = case\n      when t.backup_employee_id is not null and not private.checked_in_on(t.primary_employee_id, t.task_date)\n        then t.backup_employee_id\n      else t.primary_employee_id\n    end\n';
  v_new := E'and (p_employee_id = private.task_assignee(t.primary_employee_id, t.backup_employee_id, t.task_date)\n';
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'compute_payslip_base: không tìm thấy đúng 1 chỗ cần sửa (phạt checklist không làm).';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------
-- 6. KIỂM THỬ LƯƠNG: checklist khi nghỉ phép
-- ---------------------------------------------------------------------
create or replace function private.payroll_test_suite_leave()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r  jsonb := '[]';
  b  uuid;
  a  uuid;
  bk uuid;
  v  jsonb;
  c  text := '21 Checklist khi nghỉ phép';
  wk constant date := '2026-01-05';
begin
  insert into public.branches (name) values ('Chi nhánh kiểm thử nghỉ phép') returning id into b;
  begin
    a  := private.test_employee(b, '{"checklist_missed_penalty":50000,"checklist_late_penalty":10000,"absent_penalty":70000}');
    bk := private.test_employee(b, '{"checklist_missed_penalty":50000,"checklist_late_penalty":10000}');
    perform private.test_request(a, b, 'leave', 'approved', '2026-01-06', '2026-01-06');  -- A nghỉ phép 06
    perform private.test_shift(a, b, '2026-01-06', '08:00', '12:00');                     -- ca của A vẫn còn trên lịch
    perform private.test_shift(bk, b, '2026-01-06', '08:00', '12:00');
    perform private.test_att(a, b, '2026-01-06 08:00', '2026-01-06 09:00');                -- A nghỉ nhưng vẫn ghé chấm công
    perform private.test_att(bk, b, '2026-01-06 08:00', '2026-01-06 12:00');
    perform private.test_att(a, b, '2026-01-07 08:00', '2026-01-07 12:00');                -- 07 A đi làm bình thường
    perform private.test_task(b, '2026-01-06', '08:00', '10:00', a, bk, false, 'pending');               -- A nghỉ → người thay chịu
    perform private.test_task(b, '2026-01-06', '08:00', '10:00', a, null, false, 'pending');             -- không có người thay → không ai chịu
    perform private.test_task(b, '2026-01-06', '08:00', '10:00', a, bk, false, 'done', bk, '2026-01-06 10:30');  -- người thay làm trễ
    perform private.test_task(b, '2026-01-06', '09:00', '10:00', null, null, true, 'pending');           -- theo ca: chỉ người không nghỉ chịu
    perform private.test_task(b, '2026-01-07', '08:00', '10:00', a, bk, false, 'pending');               -- 07 A đi làm → A chịu
    v := private.compute_payslip(a, wk);
    r := r || private.test_eq(c, 'Người nghỉ: chỉ phạt không làm ngày đi làm', private.test_line(v, 'penalty_task_missed'), '-50000')
           || private.test_eq(c, 'Người nghỉ: không phạt làm trễ', coalesce(private.test_line(v, 'penalty_task_late'), '0'), '0')
           || private.test_eq(c, 'Người nghỉ: không phạt nghỉ không phép', coalesce(private.test_line(v, 'penalty_absent'), '0'), '0');
    v := private.compute_payslip(bk, wk);
    r := r || private.test_eq(c, 'Người thay: phạt không làm (việc chuyển sang + theo ca)', private.test_line(v, 'penalty_task_missed'), '-100000')
           || private.test_eq(c, 'Người thay: phạt làm trễ', private.test_line(v, 'penalty_task_late'), '-10000');
    r := r || private.test_eq(c, 'Người phụ trách khi nghỉ, không có người thay', coalesce(private.task_assignee(a, null, '2026-01-06')::text, 'null'), 'null')
           || private.test_eq(c, 'Người nghỉ không còn trong ca',
                private.on_task_shift(b, '2026-01-06 09:00+07', '2026-01-06 10:00+07', a)::text, 'false');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;
  return r;
end;
$$;

revoke all on function private.payroll_test_suite_leave() from public;

do $$
declare
  v_def text;
  v_old text := 'private.payroll_test_suite_kpi();';
begin
  select pg_get_functiondef('public.service_run_payroll_tests()'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'service_run_payroll_tests: không tìm thấy đúng 1 chỗ cần sửa';
  end if;
  execute replace(v_def, v_old, 'private.payroll_test_suite_kpi() || private.payroll_test_suite_leave();');
end $$;
