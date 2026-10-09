-- =====================================================================
-- GIAO VIỆC THEO CA (10/10/2026)
-- =====================================================================
-- Nghiệp vụ đã chốt:
--   * Mẫu có thể "giao theo ca" thay cho người cụ thể (không có người chính / người thay).
--   * Mỗi ngày: ai có CA ĐÃ CÔNG BỐ tại chi nhánh của việc, mà ca trùng khung giờ của việc
--     (ca bắt đầu trước hạn chót và kết thúc sau giờ bắt đầu) thì nhận việc.
--   * Nhiều người cùng ca: ai làm cũng được, 1 người đánh dấu là xong.
--     Bỏ sót (hết ngày chưa đánh dấu) → phạt "không làm" cho TẤT CẢ người trong ca.
--   * Không có ai trong ca: vẫn tạo việc, báo QL/QTV (từ 30 phút trước giờ bắt đầu), không phạt ai.
--   * Người nhận được tính lúc xem / đánh dấu / nhắc / tính lương → đổi lịch trong ngày áp dụng ngay.
--   * Không có 2 mẫu "theo ca" đang áp dụng cùng tên trong cùng chi nhánh (tránh việc trùng).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CỘT MỚI
-- ---------------------------------------------------------------------
alter table public.task_templates add column assign_by_shift boolean not null default false;
alter table public.task_templates
  add constraint task_templates_shift_no_person check (not assign_by_shift or (primary_employee_id is null and backup_employee_id is null));

alter table public.task_instances add column by_shift boolean not null default false;
alter table public.task_instances alter column primary_employee_id drop not null;
alter table public.task_instances
  add constraint task_instances_assignee check (
    (by_shift and primary_employee_id is null and backup_employee_id is null)
    or (not by_shift and primary_employee_id is not null)
  );

-- ---------------------------------------------------------------------
-- 2. AI ĐANG TRONG CA CỦA VIỆC
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
$$;

-- Dùng trong chính sách RLS → người dùng đăng nhập phải được chạy
revoke all on function private.on_task_shift(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function private.on_task_shift(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
revoke all on function private.task_shift_staff(uuid, timestamptz, timestamptz) from public;
grant execute on function private.task_shift_staff(uuid, timestamptz, timestamptz) to service_role;

create index shifts_branch_time_idx on public.shifts (branch_id, start_at) where status = 'published';

-- ---------------------------------------------------------------------
-- 3. TRIGGER MẪU CÔNG VIỆC
-- ---------------------------------------------------------------------
create or replace function private.task_templates_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.title       := btrim(new.title);
  new.description := nullif(btrim(new.description), '');
  new.category    := btrim(new.category);

  -- Chuẩn hóa lịch lặp
  if new.frequency = 'daily' then
    new.weekdays := '{}';
    new.month_days := '{}';
  elsif new.frequency = 'weekly' then
    new.month_days := '{}';
    select coalesce(array_agg(distinct d order by d), '{}') into new.weekdays from unnest(new.weekdays) d;
  else
    new.weekdays := '{}';
    select coalesce(array_agg(distinct d order by d), '{}') into new.month_days from unnest(new.month_days) d;
  end if;

  -- Giao theo ca → không có người cụ thể (app luôn gửi assign_by_shift = false khi giao người)
  if new.assign_by_shift then
    new.primary_employee_id := null;
    new.backup_employee_id := null;
  end if;

  -- Chưa giao người chính → không có người thay; người thay trùng người chính → bỏ người thay
  if new.primary_employee_id is null or new.backup_employee_id = new.primary_employee_id then
    new.backup_employee_id := null;
  end if;

  -- Người thực hiện phải đang hoạt động và thuộc chi nhánh của mẫu
  if new.primary_employee_id is not null and not exists (
    select 1 from public.employees e
    join public.employee_branches eb on eb.employee_id = e.id and eb.branch_id = new.branch_id
    where e.id = new.primary_employee_id and e.is_active
  ) then
    raise exception 'Người phụ trách chính phải là nhân viên đang làm tại chi nhánh của công việc "%".', new.title using errcode = 'P0001';
  end if;
  if new.backup_employee_id is not null and not exists (
    select 1 from public.employees e
    join public.employee_branches eb on eb.employee_id = e.id and eb.branch_id = new.branch_id
    where e.id = new.backup_employee_id and e.is_active
  ) then
    raise exception 'Người thay thế phải là nhân viên đang làm tại chi nhánh của công việc "%".', new.title using errcode = 'P0001';
  end if;

  new.updated_at := now();
  new.updated_by := private.current_employee_id();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := private.current_employee_id();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if new.branch_id <> old.branch_id then
      raise exception 'Không được chuyển mẫu công việc sang chi nhánh khác. Hãy tạo mẫu mới.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.task_templates_deleted_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.deleted_at is not null then
    raise exception 'Công việc "%" đã bị xóa.', old.title using errcode = 'P0001';
  end if;
  -- Chạy trước task_templates_guard (theo tên) → bỏ giao để không vướng kiểm tra nhân viên đã nghỉ
  if new.deleted_at is not null then
    new.is_active := false;
    new.assign_by_shift := false;
    new.primary_employee_id := null;
    new.backup_employee_id := null;
  end if;
  return new;
end;
$$;

-- Không trùng việc: 1 người không phụ trách 2 mẫu cùng tên; cũng không có 2 mẫu "theo ca" cùng tên
create or replace function private.task_templates_no_duplicate()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.is_active and new.primary_employee_id is not null and exists (
    select 1 from public.task_templates t
    where t.id <> new.id
      and t.branch_id = new.branch_id
      and t.primary_employee_id = new.primary_employee_id
      and t.is_active
      and private.task_title_key(t.title) = private.task_title_key(new.title)
  ) then
    select e.full_name into v_name from public.employees e where e.id = new.primary_employee_id;
    raise exception '% đã được giao công việc "%" ở chi nhánh này. Không giao trùng việc cho 1 nhân viên.', v_name, new.title
      using errcode = 'P0001';
  end if;
  if new.is_active and new.assign_by_shift and exists (
    select 1 from public.task_templates t
    where t.id <> new.id
      and t.branch_id = new.branch_id
      and t.assign_by_shift
      and t.is_active
      and private.task_title_key(t.title) = private.task_title_key(new.title)
  ) then
    raise exception 'Đã có công việc "%" giao theo ca ở chi nhánh này. Không giao trùng việc.', new.title using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create unique index task_templates_no_duplicate_shift_idx
on public.task_templates (branch_id, private.task_title_key(title))
where is_active and assign_by_shift;

-- Đồng bộ sang việc chưa làm từ hôm nay
create or replace function private.task_templates_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not new.is_active or (new.primary_employee_id is null and not new.assign_by_shift) then
    update public.task_instances i
    set status = 'cancelled', updated_at = now()
    where i.template_id = new.id and i.status = 'pending' and i.task_date >= private.vn_today();
    return new;
  end if;

  update public.task_instances i set
    title               = new.title,
    description         = new.description,
    category            = new.category,
    priority            = new.priority,
    start_at            = (i.task_date + new.start_time) at time zone 'Asia/Ho_Chi_Minh',
    due_at              = (i.task_date + new.due_time) at time zone 'Asia/Ho_Chi_Minh',
    requires_photo      = new.requires_photo,
    requires_note       = new.requires_note,
    by_shift            = new.assign_by_shift,
    primary_employee_id = new.primary_employee_id,
    backup_employee_id  = new.backup_employee_id,
    status              = case when private.task_scheduled_on(new, i.task_date) then 'pending'::public.task_status else 'cancelled'::public.task_status end,
    updated_at          = now()
  where i.template_id = new.id
    and i.status in ('pending', 'cancelled')
    and i.task_date >= private.vn_today();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. SINH VIỆC THEO NGÀY
-- ---------------------------------------------------------------------
create or replace function public.ensure_task_instances(p_date date default null)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_date  date := coalesce(p_date, private.vn_today());
  v_count integer;
begin
  if private.current_employee_id() is null and (select auth.uid()) is not null then
    raise exception 'Tài khoản không hợp lệ.' using errcode = '42501';
  end if;
  if v_date < private.vn_today() - 1 or v_date > private.vn_today() + 1 then
    raise exception 'Chỉ sinh việc cho hôm qua, hôm nay hoặc ngày mai.' using errcode = 'P0001';
  end if;

  insert into public.task_instances (
    template_id, branch_id, task_date, title, description, category, priority,
    start_at, due_at, requires_photo, requires_note, by_shift, primary_employee_id, backup_employee_id
  )
  select
    t.id, t.branch_id, v_date, t.title, t.description, t.category, t.priority,
    (v_date + t.start_time) at time zone 'Asia/Ho_Chi_Minh',
    (v_date + t.due_time) at time zone 'Asia/Ho_Chi_Minh',
    t.requires_photo, t.requires_note, t.assign_by_shift, t.primary_employee_id, t.backup_employee_id
  from public.task_templates t
  join public.branches b on b.id = t.branch_id and b.is_active
  where t.is_active
    and (t.primary_employee_id is not null or t.assign_by_shift)
    and private.task_scheduled_on(t, v_date)
  on conflict (template_id, task_date) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. ĐÁNH DẤU HOÀN THÀNH / KHÔNG ĐẠT
-- ---------------------------------------------------------------------
create or replace function public.complete_task_instance(
  p_auth_uid uuid,
  p_instance_id uuid,
  p_status public.task_status,
  p_note text default null,
  p_photo_path text default null
)
returns public.task_instances
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_emp    public.employees;
  v_inst   public.task_instances;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_branch text;
  v_result public.task_instances;
begin
  perform private.act_as(p_auth_uid);

  select * into v_emp from public.employees e where e.auth_user_id = p_auth_uid and e.is_active;
  if v_emp.id is null then
    raise exception 'Tài khoản không hợp lệ hoặc đã bị khóa.' using errcode = '42501';
  end if;

  select * into v_inst from public.task_instances i where i.id = p_instance_id for update;
  if v_inst.id is null then
    raise exception 'Không tìm thấy công việc.' using errcode = 'P0001';
  end if;
  if p_status not in ('done', 'failed') then
    raise exception 'Trạng thái không hợp lệ.' using errcode = 'P0001';
  end if;
  if v_inst.status <> 'pending' then
    raise exception 'Việc này đã được đánh dấu trước đó.' using errcode = 'P0001';
  end if;
  if v_inst.task_date <> private.vn_today() then
    raise exception 'Chỉ đánh dấu được công việc của hôm nay.' using errcode = 'P0001';
  end if;

  -- Ai được làm
  if v_inst.by_shift then
    if not private.on_task_shift(v_inst.branch_id, v_inst.start_at, v_inst.due_at, v_emp.id) then
      raise exception 'Việc này giao theo ca — bạn không có ca trùng giờ việc hôm nay.' using errcode = '42501';
    end if;
  elsif v_emp.id = v_inst.primary_employee_id then
    null;
  elsif v_emp.id = v_inst.backup_employee_id then
    if private.checked_in_on(v_inst.primary_employee_id, v_inst.task_date) then
      raise exception 'Người phụ trách chính đã đi làm hôm nay nên việc này do họ thực hiện.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Việc này không được giao cho bạn.' using errcode = '42501';
  end if;

  -- Phải đang trong ca tại chi nhánh của việc (trừ người không phải chấm công)
  if v_emp.role <> 'admin' and v_emp.requires_attendance and not exists (
    select 1 from public.attendance_records a
    where a.employee_id = v_emp.id and a.check_out_at is null and a.branch_id = v_inst.branch_id
  ) then
    select b.name into v_branch from public.branches b where b.id = v_inst.branch_id;
    raise exception 'Bạn cần vào ca tại % trước khi đánh dấu công việc.', v_branch using errcode = 'P0001';
  end if;

  -- Bằng chứng
  if p_status = 'failed' and char_length(coalesce(v_note, '')) < 3 then
    raise exception 'Vui lòng ghi lý do không hoàn thành được.' using errcode = 'P0001';
  end if;
  if p_status = 'done' and v_inst.requires_note and v_note is null then
    raise exception 'Việc này bắt buộc ghi chú.' using errcode = 'P0001';
  end if;
  if p_status = 'done' and v_inst.requires_photo and p_photo_path is null then
    raise exception 'Việc này bắt buộc chụp ảnh.' using errcode = 'P0001';
  end if;

  update public.task_instances i set
    status       = p_status,
    completed_by = v_emp.id,
    completed_at = now(),
    note         = v_note,
    photo_path   = p_photo_path,
    updated_at   = now()
  where i.id = v_inst.id and i.status = 'pending'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Việc này đã được đánh dấu trước đó.' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. RLS: nhân viên thấy việc theo ca khi mình có ca trùng giờ
-- ---------------------------------------------------------------------
drop policy "task_instances_select" on public.task_instances;
create policy "task_instances_select"
on public.task_instances for select
to authenticated
using (
  (select private.manages_branch(branch_id))
  or primary_employee_id = (select private.current_employee_id())
  or backup_employee_id  = (select private.current_employee_id())
  or (by_shift and private.on_task_shift(branch_id, start_at, due_at, (select private.current_employee_id())))
);

-- ---------------------------------------------------------------------
-- 7. NHẮC VIỆC (cron mỗi phút)
-- ---------------------------------------------------------------------
create or replace function private.enqueue_task_notifications()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_today  date := private.vn_today();
  v_before interval := interval '30 minutes';  -- báo trước hạn chót / trước giờ bắt đầu (việc không người)
  v_window interval := interval '6 hours';     -- chỉ báo quá hạn trong vòng 6 giờ sau hạn (tránh dồn báo cũ)
  v_total  integer := 0;
  v_count  integer;
begin
  -- Việc của hôm nay phải tồn tại kể cả khi chưa ai mở app
  perform public.ensure_task_instances(v_today);

  -- Người phụ trách: người chính (+ người thay nếu người chính chưa chấm công); việc theo ca: mọi người trong ca
  create temp table if not exists tmp_task_recipients (task_id uuid, employee_id uuid, stage text) on commit drop;
  truncate tmp_task_recipients;

  insert into tmp_task_recipients (task_id, employee_id, stage)
  select t.id, r.employee_id, case when now() >= t.due_at then 'overdue' else 'due_soon' end
  from public.task_instances t
  cross join lateral (
    select t.primary_employee_id as employee_id
    where not t.by_shift
    union
    select t.backup_employee_id
    where not t.by_shift and t.backup_employee_id is not null and not private.checked_in_on(t.primary_employee_id, t.task_date)
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
         coalesce(
           p.full_name,
           (select 'Ca: ' || string_agg(se.full_name, ', ')
            from private.task_shift_staff(t.branch_id, t.start_at, t.due_at) s(staff_id)
            join public.employees se on se.id = s.staff_id),
           'Không có người trong ca'
         ) || ' · ' || b.name || ' · hạn ' || to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'),
         '/checklist/manage?date=' || t.task_date
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
    and t.task_date between v_today - 1 and v_today
    and now() >= t.due_at and now() < t.due_at + v_window
    and not exists (select 1 from tmp_task_recipients r where r.task_id = t.id and r.employee_id = m.id)
  on conflict (employee_id, kind, task_instance_id) do nothing;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  -- Việc theo ca mà không có ai trong ca → báo QL + QTV từ 30 phút trước giờ bắt đầu
  insert into public.notifications (employee_id, kind, task_instance_id, title, body, url)
  select m.id, 'task_no_staff', t.id,
         '⚠️ Không có người trong ca: ' || t.title,
         to_char(t.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || '–'
           || to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || ' · ' || b.name
           || ' — hãy xếp ca hoặc giao người làm.',
         '/checklist/manage'
  from public.task_instances t
  join public.branches b on b.id = t.branch_id
  join public.employees m on m.is_active and (
    m.role = 'admin'
    or (m.role = 'manager' and exists (
      select 1 from public.employee_branches eb where eb.employee_id = m.id and eb.branch_id = t.branch_id
    ))
  )
  where t.by_shift
    and t.status = 'pending'
    and t.task_date = v_today
    and now() >= t.start_at - v_before and now() < t.due_at
    and not exists (select 1 from private.task_shift_staff(t.branch_id, t.start_at, t.due_at))
  on conflict (employee_id, kind, task_instance_id) do nothing;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. TÍNH LƯƠNG: bỏ sót việc theo ca → phạt "không làm" cho mọi người trong ca
-- ---------------------------------------------------------------------
-- Sửa đúng 1 chỗ trong private.compute_payslip_base (hàm rất dài) bằng cách thay chuỗi có kiểm tra.
do $$
declare
  v_def text;
  v_old_head text := 'and p_employee_id = case';
  v_new_head text := 'and (p_employee_id = case';
  v_old_tail text := E'else t.primary_employee_id\n    end;';
  v_new_tail text := E'else t.primary_employee_id\n    end\n    or (t.by_shift and private.on_task_shift(t.branch_id, t.start_at, t.due_at, p_employee_id)));';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'compute_payslip_base';

  if (length(v_def) - length(replace(v_def, v_old_head, ''))) / length(v_old_head) <> 1
     or (length(v_def) - length(replace(v_def, v_old_tail, ''))) / length(v_old_tail) <> 1 then
    raise exception 'compute_payslip_base: không tìm thấy đúng 1 chỗ cần sửa (phạt checklist không làm).';
  end if;

  execute replace(replace(v_def, v_old_head, v_new_head), v_old_tail, v_new_tail);
end $$;
