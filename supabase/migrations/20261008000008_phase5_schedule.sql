-- =====================================================================
-- PHASE 5 — LỊCH LÀM VIỆC + ĐƠN XIN PHÉP (+ nối vào bảng lương)
-- =====================================================================
-- Nghiệp vụ đã chốt (08/10/2026):
--   * QTV + Quản lý (chi nhánh mình) xếp lịch. Mẫu ca, xếp từng ca, sao chép tuần trước.
--   * Nháp → Công bố. NV chỉ thấy lịch đã công bố (cả chi nhánh mình). Ca đã công bố chỉ hủy (có lý do).
--   * Đơn: nghỉ (theo ngày), đi trễ, về sớm, đổi/nhường ca (người kia đồng ý → QL duyệt).
--   * Hạn gửi tối thiểu & số lần/tháng do QTV cài: gửi sát giờ = "Gấp", vượt giới hạn = cảnh báo (vẫn gửi được).
--   * Lương: trễ so với ca đầu ngày theo lịch (không có lịch → giờ vào ca mặc định); trễ có phép → mốc = giờ đã xin.
--     Về sớm không phép & nghỉ không phép (có ca, không chấm công, không có đơn nghỉ) bị phạt.
--     Nghỉ có phép có lương (chỉ QTV đánh dấu) = 1 ngày công cho lương cố định.
--   * Chấm công vẫn tự do (không bắt buộc có ca).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MỨC PHẠT MỚI
-- ---------------------------------------------------------------------
alter table public.payroll_settings
  add column early_grace_minutes integer not null default 5,
  add column early_leave_penalty bigint  not null default 0,
  add column absent_penalty      bigint  not null default 0;
alter table public.payroll_settings add constraint payroll_settings_values2 check (
  early_grace_minutes between 0 and 240 and early_leave_penalty >= 0 and absent_penalty >= 0
);

alter table public.payroll_profiles
  add column early_grace_minutes integer,
  add column early_leave_penalty bigint,
  add column absent_penalty      bigint;
alter table public.payroll_profiles add constraint payroll_profiles_amounts2 check (
  coalesce(early_grace_minutes, 0) between 0 and 240 and coalesce(early_leave_penalty, 0) >= 0 and coalesce(absent_penalty, 0) >= 0
);

-- ---------------------------------------------------------------------
-- 2. CÀI ĐẶT ĐƠN XIN PHÉP (1 dòng)
-- ---------------------------------------------------------------------
create table public.schedule_settings (
  id                   boolean primary key default true,
  leave_notice_hours   integer not null default 24,
  late_notice_hours    integer not null default 2,
  early_notice_hours   integer not null default 2,
  swap_notice_hours    integer not null default 24,
  leave_days_per_month integer not null default 2,
  late_per_month       integer not null default 3,
  early_per_month      integer not null default 3,
  swap_per_month       integer not null default 4,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.employees (id),
  constraint schedule_settings_single check (id),
  constraint schedule_settings_values check (
    leave_notice_hours between 0 and 720 and late_notice_hours between 0 and 720
    and early_notice_hours between 0 and 720 and swap_notice_hours between 0 and 720
    and leave_days_per_month between 0 and 31 and late_per_month between 0 and 31
    and early_per_month between 0 and 31 and swap_per_month between 0 and 31
  )
);
insert into public.schedule_settings (id) values (true);
create index schedule_settings_updated_by_idx on public.schedule_settings (updated_by);

create trigger schedule_settings_guard
before update on public.schedule_settings
for each row execute function private.payroll_settings_guard();

create or replace function private.settings_audit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (table_name, action, actor_auth_uid, actor_employee_id, old_data, new_data)
  values (tg_table_name, 'UPDATE', (select auth.uid()), private.current_employee_id(), to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

create trigger schedule_settings_audit
after update on public.schedule_settings
for each row execute function private.settings_audit();

-- NV có thuộc chi nhánh này không
create or replace function private.in_my_branch(p_branch_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employee_branches eb
    where eb.employee_id = private.current_employee_id() and eb.branch_id = p_branch_id
  )
$$;
revoke all on function private.in_my_branch(uuid) from public;
grant execute on function private.in_my_branch(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. MẪU CA
-- ---------------------------------------------------------------------
create table public.shift_templates (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches (id),
  name       text not null,
  start_time time not null,
  end_time   time not null,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees (id),
  constraint shift_templates_name_unique unique (branch_id, name),
  constraint shift_templates_name_len check (char_length(btrim(name)) between 1 and 50),
  constraint shift_templates_times check (start_time <> end_time)
);
create index shift_templates_created_by_idx on public.shift_templates (created_by);
create index shift_templates_updated_by_idx on public.shift_templates (updated_by);

create or replace function private.stamp_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := private.current_employee_id();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := private.current_employee_id();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create or replace function private.shift_templates_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' and new.branch_id <> old.branch_id then
    raise exception 'Không được chuyển mẫu ca sang chi nhánh khác.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger shift_templates_guard
before insert or update on public.shift_templates
for each row execute function private.shift_templates_guard();
create trigger shift_templates_stamp
before insert or update on public.shift_templates
for each row execute function private.stamp_row();
create trigger shift_templates_audit
after insert or update on public.shift_templates
for each row execute function private.write_audit_log();
create trigger shift_templates_forbid_delete
before delete on public.shift_templates
for each row execute function private.forbid_delete();

-- ---------------------------------------------------------------------
-- 4. CA LÀM VIỆC
-- ---------------------------------------------------------------------
create type public.shift_status as enum ('draft', 'published', 'cancelled');

create table public.shifts (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches (id),
  employee_id   uuid not null references public.employees (id),
  work_date     date not null,
  start_time    time not null,
  end_time      time not null,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  template_id   uuid references public.shift_templates (id),
  note          text,
  status        public.shift_status not null default 'draft',
  published_at  timestamptz,
  cancelled_at  timestamptz,
  cancelled_by  uuid references public.employees (id),
  cancel_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.employees (id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.employees (id),
  constraint shifts_duration check (end_at > start_at and end_at - start_at <= interval '16 hours'),
  constraint shifts_note_len check (note is null or char_length(note) <= 200),
  constraint shifts_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status <> 'cancelled') deferrable initially immediate
);
create index shifts_branch_date_idx   on public.shifts (branch_id, work_date);
create index shifts_employee_date_idx on public.shifts (employee_id, work_date);
create index shifts_template_idx      on public.shifts (template_id);
create index shifts_created_by_idx    on public.shifts (created_by);
create index shifts_updated_by_idx    on public.shifts (updated_by);
create index shifts_cancelled_by_idx  on public.shifts (cancelled_by);

create or replace function private.shifts_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'cancelled' then
      raise exception 'Ca đã hủy, không sửa được.' using errcode = 'P0001';
    end if;
    if new.branch_id <> old.branch_id then
      raise exception 'Không được chuyển ca sang chi nhánh khác.' using errcode = 'P0001';
    end if;
    if old.status = 'published' and new.status = 'draft' then
      raise exception 'Ca đã công bố không chuyển lại thành nháp được.' using errcode = 'P0001';
    end if;
    if old.status = 'published' and (new.work_date <> old.work_date or new.start_time <> old.start_time or new.end_time <> old.end_time) then
      raise exception 'Ca đã công bố không đổi ngày/giờ được. Hãy hủy ca và tạo ca mới.' using errcode = 'P0001';
    end if;
  end if;

  new.note := nullif(btrim(new.note), '');
  new.start_at := (new.work_date + new.start_time) at time zone 'Asia/Ho_Chi_Minh';
  new.end_at := (new.work_date + (case when new.end_time <= new.start_time then 1 else 0 end) + new.end_time) at time zone 'Asia/Ho_Chi_Minh';

  if tg_op = 'INSERT' or new.employee_id <> old.employee_id then
    if not exists (
      select 1 from public.employees e
      join public.employee_branches eb on eb.employee_id = e.id and eb.branch_id = new.branch_id
      where e.id = new.employee_id and e.is_active
    ) then
      raise exception 'Nhân viên không thuộc chi nhánh này hoặc đã bị khóa.' using errcode = 'P0001';
    end if;
  end if;

  if new.template_id is not null and not exists (
    select 1 from public.shift_templates t where t.id = new.template_id and t.branch_id = new.branch_id
  ) then
    raise exception 'Mẫu ca không thuộc chi nhánh này.' using errcode = 'P0001';
  end if;

  if new.status = 'published' and (tg_op = 'INSERT' or old.status = 'draft') then
    new.published_at := now();
  end if;
  if new.status = 'cancelled' then
    if char_length(btrim(coalesce(new.cancel_reason, ''))) < 3 then
      raise exception 'Vui lòng nhập lý do hủy ca.' using errcode = 'P0001';
    end if;
    new.cancel_reason := btrim(new.cancel_reason);
    new.cancelled_at := now();
    new.cancelled_by := private.current_employee_id();
  end if;
  return new;
end;
$$;

create trigger shifts_guard
before insert or update on public.shifts
for each row execute function private.shifts_guard();
create trigger shifts_stamp
before insert or update on public.shifts
for each row execute function private.stamp_row();
create trigger shifts_audit
after insert or update or delete on public.shifts
for each row execute function private.write_audit_log();

create or replace function private.shifts_delete_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    raise exception 'Ca đã công bố chỉ được hủy (kèm lý do), không xóa.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger shifts_delete_guard
before delete on public.shifts
for each row execute function private.shifts_delete_guard();

-- Công bố lịch 1 tuần của 1 chi nhánh
create or replace function public.publish_week_shifts(p_branch_id uuid, p_week_start date)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.manages_branch(p_branch_id) then
    raise exception 'Bạn không có quyền xếp lịch chi nhánh này.' using errcode = '42501';
  end if;
  if extract(isodow from p_week_start) <> 1 then
    raise exception 'Ngày bắt đầu tuần phải là thứ Hai.' using errcode = 'P0001';
  end if;
  update public.shifts s set status = 'published'
  where s.branch_id = p_branch_id and s.status = 'draft'
    and s.work_date between p_week_start and p_week_start + 6;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Sao chép lịch 1 tuần sang tuần khác (thành nháp); ca trùng giờ / NV không còn thuộc chi nhánh thì bỏ qua
create or replace function public.copy_week_shifts(p_branch_id uuid, p_from_week date, p_to_week date)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_copied  integer := 0;
  v_skipped integer := 0;
  v_offset  integer := p_to_week - p_from_week;
  r         record;
begin
  if not private.manages_branch(p_branch_id) then
    raise exception 'Bạn không có quyền xếp lịch chi nhánh này.' using errcode = '42501';
  end if;
  if extract(isodow from p_from_week) <> 1 or extract(isodow from p_to_week) <> 1 or p_from_week = p_to_week then
    raise exception 'Tuần không hợp lệ.' using errcode = 'P0001';
  end if;

  for r in
    select s.employee_id, s.work_date, s.start_time, s.end_time, s.template_id, s.note
    from public.shifts s
    where s.branch_id = p_branch_id and s.status <> 'cancelled'
      and s.work_date between p_from_week and p_from_week + 6
    order by s.work_date, s.start_time
  loop
    begin
      insert into public.shifts (branch_id, employee_id, work_date, start_time, end_time, template_id, note)
      values (p_branch_id, r.employee_id, r.work_date + v_offset, r.start_time, r.end_time, r.template_id, r.note);
      v_copied := v_copied + 1;
    exception when exclusion_violation or raise_exception then
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object('copied', v_copied, 'skipped', v_skipped);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. ĐƠN XIN PHÉP
-- ---------------------------------------------------------------------
create type public.request_kind   as enum ('leave', 'late', 'early_leave', 'swap');
create type public.request_status as enum ('awaiting_peer', 'pending', 'approved', 'rejected', 'cancelled');

create table public.schedule_requests (
  id                 uuid primary key default gen_random_uuid(),
  employee_id        uuid not null references public.employees (id),
  kind               public.request_kind not null,
  branch_id          uuid references public.branches (id),
  start_date         date,
  end_date           date,
  shift_id           uuid references public.shifts (id),
  requested_time     time,
  target_employee_id uuid references public.employees (id),
  target_shift_id    uuid references public.shifts (id),
  reason             text not null,
  is_urgent          boolean not null default false,
  over_limit         boolean not null default false,
  status             public.request_status not null,
  peer_responded_at  timestamptz,
  reviewed_by        uuid references public.employees (id),
  reviewed_at        timestamptz,
  review_note        text,
  is_paid            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint schedule_requests_reason check (char_length(btrim(reason)) between 3 and 500),
  constraint schedule_requests_shape check (
    (kind = 'leave' and start_date is not null and end_date is not null and end_date >= start_date and end_date - start_date <= 30)
    or (kind in ('late', 'early_leave') and shift_id is not null and requested_time is not null)
    or (kind = 'swap' and shift_id is not null and target_employee_id is not null)
  ),
  constraint schedule_requests_paid check (is_paid = false or kind = 'leave')
);
create index schedule_requests_employee_idx on public.schedule_requests (employee_id, created_at desc);
create index schedule_requests_branch_idx   on public.schedule_requests (branch_id, status);
create index schedule_requests_shift_idx    on public.schedule_requests (shift_id);
create index schedule_requests_tshift_idx   on public.schedule_requests (target_shift_id);
create index schedule_requests_target_idx   on public.schedule_requests (target_employee_id);
create index schedule_requests_reviewer_idx on public.schedule_requests (reviewed_by);

create trigger schedule_requests_audit
after insert or update on public.schedule_requests
for each row execute function private.write_audit_log();
create trigger schedule_requests_forbid_delete
before delete on public.schedule_requests
for each row execute function private.forbid_delete();

-- Thời điểm thực của "giờ đã xin" trên 1 ca (ca qua đêm: giờ nhỏ hơn giờ bắt đầu → ngày hôm sau)
create or replace function private.shift_time_at(p_work_date date, p_start time, p_time time)
returns timestamptz
language sql immutable
set search_path = ''
as $$
  select (p_work_date + (case when p_time < p_start then 1 else 0 end) + p_time) at time zone 'Asia/Ho_Chi_Minh'
$$;

create or replace function public.create_schedule_request(
  p_kind public.request_kind,
  p_reason text,
  p_start_date date default null,
  p_end_date date default null,
  p_shift_id uuid default null,
  p_requested_time time default null,
  p_target_employee_id uuid default null,
  p_target_shift_id uuid default null
)
returns public.schedule_requests
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me       uuid := private.current_employee_id();
  v_set      public.schedule_settings;
  v_shift    public.shifts;
  v_tshift   public.shifts;
  v_event    timestamptz;
  v_notice   integer;
  v_limit    integer;
  v_used     integer;
  v_month    date;
  v_req_at   timestamptz;
  v_branch   uuid;
  v_status   public.request_status := 'pending';
  v_result   public.schedule_requests;
begin
  if v_me is null then
    raise exception 'Tài khoản không hợp lệ.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Vui lòng nhập lý do (ít nhất 3 ký tự).' using errcode = 'P0001';
  end if;
  select * into v_set from public.schedule_settings limit 1;

  if p_kind = 'leave' then
    if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
      raise exception 'Ngày nghỉ không hợp lệ.' using errcode = 'P0001';
    end if;
    if p_start_date < private.vn_today() then
      raise exception 'Không xin nghỉ cho ngày đã qua.' using errcode = 'P0001';
    end if;
    if p_end_date - p_start_date > 30 then
      raise exception 'Mỗi đơn nghỉ tối đa 31 ngày.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.schedule_requests q
      where q.employee_id = v_me and q.kind = 'leave' and q.status in ('pending', 'approved')
        and daterange(q.start_date, q.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
    ) then
      raise exception 'Bạn đã có đơn nghỉ trùng ngày.' using errcode = 'P0001';
    end if;
    v_event  := p_start_date::timestamp at time zone 'Asia/Ho_Chi_Minh';
    v_notice := v_set.leave_notice_hours;
    v_month  := date_trunc('month', p_start_date)::date;
    select coalesce(sum(q.end_date - q.start_date + 1), 0) into v_used
    from public.schedule_requests q
    where q.employee_id = v_me and q.kind = 'leave' and q.status in ('pending', 'approved')
      and date_trunc('month', q.start_date) = v_month;
    v_limit := v_set.leave_days_per_month;
    v_used  := v_used + (p_end_date - p_start_date + 1);
  else
    select * into v_shift from public.shifts s where s.id = p_shift_id;
    if v_shift.id is null or v_shift.employee_id <> v_me or v_shift.status <> 'published' then
      raise exception 'Không tìm thấy ca làm của bạn.' using errcode = 'P0001';
    end if;
    v_branch := v_shift.branch_id;
    v_month  := date_trunc('month', v_shift.work_date)::date;

    if p_kind in ('late', 'early_leave') then
      if p_requested_time is null then
        raise exception 'Vui lòng nhập giờ dự kiến.' using errcode = 'P0001';
      end if;
      v_req_at := private.shift_time_at(v_shift.work_date, v_shift.start_time, p_requested_time);
      if v_req_at <= v_shift.start_at or v_req_at >= v_shift.end_at then
        raise exception 'Giờ dự kiến phải nằm trong khoảng thời gian của ca.' using errcode = 'P0001';
      end if;
      if p_kind = 'late' then
        if v_shift.start_at <= now() then
          raise exception 'Ca đã bắt đầu, không xin đi trễ được nữa.' using errcode = 'P0001';
        end if;
        v_event  := v_shift.start_at;
        v_notice := v_set.late_notice_hours;
        v_limit  := v_set.late_per_month;
      else
        if v_req_at <= now() then
          raise exception 'Giờ xin về đã qua.' using errcode = 'P0001';
        end if;
        v_event  := v_req_at;
        v_notice := v_set.early_notice_hours;
        v_limit  := v_set.early_per_month;
      end if;
    else
      -- Đổi / nhường ca
      if v_shift.start_at <= now() then
        raise exception 'Ca đã bắt đầu, không đổi được nữa.' using errcode = 'P0001';
      end if;
      if p_target_employee_id is null or p_target_employee_id = v_me then
        raise exception 'Vui lòng chọn người nhận ca.' using errcode = 'P0001';
      end if;
      if not exists (
        select 1 from public.employees e
        join public.employee_branches eb on eb.employee_id = e.id and eb.branch_id = v_shift.branch_id
        where e.id = p_target_employee_id and e.is_active
      ) then
        raise exception 'Người nhận không thuộc chi nhánh của ca này.' using errcode = 'P0001';
      end if;
      v_event := v_shift.start_at;
      if p_target_shift_id is not null then
        select * into v_tshift from public.shifts s where s.id = p_target_shift_id;
        if v_tshift.id is null or v_tshift.employee_id <> p_target_employee_id or v_tshift.status <> 'published'
           or v_tshift.branch_id <> v_shift.branch_id or v_tshift.start_at <= now() then
          raise exception 'Ca muốn đổi không hợp lệ.' using errcode = 'P0001';
        end if;
        v_event := least(v_event, v_tshift.start_at);
      end if;
      v_status := 'awaiting_peer';
      v_notice := v_set.swap_notice_hours;
      v_limit  := v_set.swap_per_month;
    end if;

    if exists (
      select 1 from public.schedule_requests q
      where q.shift_id = p_shift_id and q.employee_id = v_me and q.kind = p_kind
        and q.status in ('awaiting_peer', 'pending', 'approved')
    ) then
      raise exception 'Ca này đã có đơn cùng loại.' using errcode = 'P0001';
    end if;

    select count(*) + 1 into v_used
    from public.schedule_requests q
    join public.shifts s on s.id = q.shift_id
    where q.employee_id = v_me and q.kind = p_kind and q.status in ('awaiting_peer', 'pending', 'approved')
      and date_trunc('month', s.work_date) = v_month;
  end if;

  insert into public.schedule_requests (
    employee_id, kind, branch_id, start_date, end_date, shift_id, requested_time,
    target_employee_id, target_shift_id, reason, is_urgent, over_limit, status
  ) values (
    v_me, p_kind, v_branch,
    case when p_kind = 'leave' then p_start_date end,
    case when p_kind = 'leave' then p_end_date end,
    case when p_kind = 'leave' then null else p_shift_id end,
    case when p_kind in ('late', 'early_leave') then p_requested_time end,
    case when p_kind = 'swap' then p_target_employee_id end,
    case when p_kind = 'swap' then p_target_shift_id end,
    btrim(p_reason),
    now() + make_interval(hours => v_notice) > v_event,
    v_used > v_limit,
    v_status
  )
  returning * into v_result;
  return v_result;
end;
$$;

-- Người nhận đồng ý / từ chối đổi ca
create or replace function public.respond_swap_request(p_request_id uuid, p_accept boolean)
returns public.schedule_requests
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_result public.schedule_requests;
begin
  update public.schedule_requests q set
    status            = case when p_accept then 'pending'::public.request_status else 'rejected'::public.request_status end,
    review_note       = case when p_accept then null else 'Người nhận đã từ chối.' end,
    peer_responded_at = now(),
    updated_at        = now()
  where q.id = p_request_id
    and q.target_employee_id = private.current_employee_id()
    and q.status = 'awaiting_peer'
  returning * into v_result;
  if v_result.id is null then
    raise exception 'Không tìm thấy yêu cầu đổi ca chờ bạn trả lời.' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

create or replace function public.cancel_schedule_request(p_request_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.schedule_requests q set status = 'cancelled', updated_at = now()
  where q.id = p_request_id and q.employee_id = private.current_employee_id()
    and q.status in ('awaiting_peer', 'pending');
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Không hủy được đơn này (không phải của bạn hoặc đã được xử lý).' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.can_review_request(p_req public.schedule_requests)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case
    when p_req.branch_id is not null then private.manages_branch(p_req.branch_id)
    else private.manages_employee(p_req.employee_id)
  end
$$;
revoke all on function private.can_review_request(public.schedule_requests) from public;
grant execute on function private.can_review_request(public.schedule_requests) to authenticated, service_role;

create or replace function public.review_schedule_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null,
  p_paid boolean default false
)
returns public.schedule_requests
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_employee_id();
  v_req    public.schedule_requests;
  v_shift  public.shifts;
  v_tshift public.shifts;
  v_result public.schedule_requests;
begin
  select * into v_req from public.schedule_requests q where q.id = p_request_id for update;
  if v_req.id is null or not private.can_review_request(v_req) then
    raise exception 'Không tìm thấy đơn hoặc bạn không có quyền duyệt.' using errcode = '42501';
  end if;
  if v_me in (v_req.employee_id, v_req.target_employee_id) then
    raise exception 'Bạn không thể tự duyệt đơn liên quan đến mình.' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Đơn này không ở trạng thái chờ duyệt.' using errcode = 'P0001';
  end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Vui lòng ghi lý do từ chối.' using errcode = 'P0001';
  end if;

  if p_approve and v_req.kind = 'swap' then
    select * into v_shift from public.shifts s where s.id = v_req.shift_id for update;
    if v_shift.employee_id <> v_req.employee_id or v_shift.status <> 'published' or v_shift.start_at <= now() then
      raise exception 'Ca cần đổi đã thay đổi hoặc đã bắt đầu, không duyệt được nữa.' using errcode = 'P0001';
    end if;
    if v_req.target_shift_id is not null then
      select * into v_tshift from public.shifts s where s.id = v_req.target_shift_id for update;
      if v_tshift.employee_id <> v_req.target_employee_id or v_tshift.status <> 'published' or v_tshift.start_at <= now() then
        raise exception 'Ca của người nhận đã thay đổi hoặc đã bắt đầu, không duyệt được nữa.' using errcode = 'P0001';
      end if;
    end if;
    begin
      set constraints public.shifts_no_overlap deferred;
      update public.shifts s set employee_id = v_req.target_employee_id where s.id = v_req.shift_id;
      if v_req.target_shift_id is not null then
        update public.shifts s set employee_id = v_req.employee_id where s.id = v_req.target_shift_id;
      end if;
      set constraints public.shifts_no_overlap immediate;
    exception when exclusion_violation then
      raise exception 'Đổi ca làm trùng giờ với một ca khác của nhân viên.' using errcode = 'P0001';
    end;
  end if;

  update public.schedule_requests q set
    status      = case when p_approve then 'approved'::public.request_status else 'rejected'::public.request_status end,
    reviewed_by = v_me,
    reviewed_at = now(),
    review_note = nullif(btrim(coalesce(p_note, '')), ''),
    is_paid     = (p_approve and v_req.kind = 'leave' and coalesce(p_paid, false) and private.is_admin()),
    updated_at  = now()
  where q.id = v_req.id
  returning * into v_result;
  return v_result;
end;
$$;

-- QTV đổi cờ "nghỉ có lương" (trước khi chốt lương các ngày liên quan)
create or replace function public.set_leave_paid(p_request_id uuid, p_paid boolean)
returns public.schedule_requests
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_req    public.schedule_requests;
  v_result public.schedule_requests;
begin
  if not private.is_admin() then
    raise exception 'Chỉ Quản trị viên mới được đánh dấu nghỉ có lương.' using errcode = '42501';
  end if;
  select * into v_req from public.schedule_requests q where q.id = p_request_id for update;
  if v_req.id is null or v_req.kind <> 'leave' or v_req.status <> 'approved' then
    raise exception 'Chỉ áp dụng cho đơn nghỉ đã duyệt.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.payslips p
    where p.employee_id = v_req.employee_id
      and daterange(p.period_start, p.period_end, '[]') && daterange(v_req.start_date, v_req.end_date, '[]')
  ) then
    raise exception 'Kỳ lương chứa ngày nghỉ này đã chốt. Hãy điều chỉnh bằng truy lĩnh/truy thu.' using errcode = 'P0001';
  end if;
  update public.schedule_requests q set is_paid = p_paid, updated_at = now()
  where q.id = v_req.id
  returning * into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. QUYỀN THỰC THI HÀM
-- ---------------------------------------------------------------------
revoke all on function public.publish_week_shifts(uuid, date) from public, anon;
revoke all on function public.copy_week_shifts(uuid, date, date) from public, anon;
revoke all on function public.create_schedule_request(public.request_kind, text, date, date, uuid, time, uuid, uuid) from public, anon;
revoke all on function public.respond_swap_request(uuid, boolean) from public, anon;
revoke all on function public.cancel_schedule_request(uuid) from public, anon;
revoke all on function public.review_schedule_request(uuid, boolean, text, boolean) from public, anon;
revoke all on function public.set_leave_paid(uuid, boolean) from public, anon;
grant execute on function public.publish_week_shifts(uuid, date) to authenticated;
grant execute on function public.copy_week_shifts(uuid, date, date) to authenticated;
grant execute on function public.create_schedule_request(public.request_kind, text, date, date, uuid, time, uuid, uuid) to authenticated;
grant execute on function public.respond_swap_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_schedule_request(uuid) to authenticated;
grant execute on function public.review_schedule_request(uuid, boolean, text, boolean) to authenticated;
grant execute on function public.set_leave_paid(uuid, boolean) to authenticated;
revoke all on function private.shift_time_at(date, time, time) from public;

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------
alter table public.schedule_settings enable row level security;
alter table public.shift_templates   enable row level security;
alter table public.shifts            enable row level security;
alter table public.schedule_requests enable row level security;

revoke all on public.schedule_settings from anon;
revoke all on public.shift_templates   from anon;
revoke all on public.shifts            from anon;
revoke all on public.schedule_requests from anon;
revoke insert, delete, truncate on public.schedule_settings from authenticated;
revoke delete, truncate on public.shift_templates from authenticated;
revoke truncate on public.shifts from authenticated;
revoke insert, update, delete, truncate on public.schedule_requests from authenticated;

create policy "schedule_settings_select" on public.schedule_settings for select to authenticated
using ((select private.current_employee_id()) is not null);
create policy "schedule_settings_update_admin" on public.schedule_settings for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "shift_templates_select" on public.shift_templates for select to authenticated
using ((select private.manages_branch(branch_id)) or (select private.in_my_branch(branch_id)));
create policy "shift_templates_insert" on public.shift_templates for insert to authenticated
with check ((select private.manages_branch(branch_id)));
create policy "shift_templates_update" on public.shift_templates for update to authenticated
using ((select private.manages_branch(branch_id))) with check ((select private.manages_branch(branch_id)));

create policy "shifts_select" on public.shifts for select to authenticated
using (
  (select private.manages_branch(branch_id))
  or (status <> 'draft' and (select private.in_my_branch(branch_id)))
);
create policy "shifts_insert" on public.shifts for insert to authenticated
with check ((select private.manages_branch(branch_id)));
create policy "shifts_update" on public.shifts for update to authenticated
using ((select private.manages_branch(branch_id))) with check ((select private.manages_branch(branch_id)));
create policy "shifts_delete" on public.shifts for delete to authenticated
using ((select private.manages_branch(branch_id)));

create policy "schedule_requests_select" on public.schedule_requests for select to authenticated
using (
  employee_id = (select private.current_employee_id())
  or target_employee_id = (select private.current_employee_id())
  or (branch_id is not null and (select private.manages_branch(branch_id)))
  or (branch_id is null and (select private.manages_employee(employee_id)))
);

-- ---------------------------------------------------------------------
-- 8. HỦY CA → tự hủy các đơn đang chờ liên quan đến ca đó
-- ---------------------------------------------------------------------
create or replace function private.shifts_cancel_requests()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.schedule_requests q set
    status = 'cancelled', review_note = 'Ca đã bị hủy.', updated_at = now()
  where (q.shift_id = new.id or q.target_shift_id = new.id)
    and q.status in ('awaiting_peer', 'pending');
  return new;
end;
$$;

create trigger shifts_cancel_requests
after update of status on public.shifts
for each row when (new.status = 'cancelled' and old.status <> 'cancelled')
execute function private.shifts_cancel_requests();

-- ---------------------------------------------------------------------
-- 9. ĐỌC LỊCH (NV thường không đọc được tên đồng nghiệp qua RLS bảng employees)
-- ---------------------------------------------------------------------
-- Lịch 1 tuần của chi nhánh: QL/QTV thấy cả nháp, NV chỉ thấy đã công bố/đã hủy
create or replace function public.branch_week_schedule(p_branch_id uuid, p_week_start date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_manage boolean := private.manages_branch(p_branch_id);
begin
  if not v_manage and not private.in_my_branch(p_branch_id) then
    raise exception 'Bạn không thuộc chi nhánh này.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'can_manage', v_manage,
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'employee_id', s.employee_id, 'employee_name', e.full_name,
        'work_date', s.work_date, 'start_time', to_char(s.start_time, 'HH24:MI'), 'end_time', to_char(s.end_time, 'HH24:MI'),
        'start_at', s.start_at, 'end_at', s.end_at, 'template_id', s.template_id, 'note', s.note,
        'status', s.status, 'cancel_reason', s.cancel_reason
      ) order by s.work_date, s.start_time, e.full_name)
      from public.shifts s
      join public.employees e on e.id = s.employee_id
      where s.branch_id = p_branch_id
        and s.work_date between p_week_start and p_week_start + 6
        and (v_manage or s.status <> 'draft')
    ), '[]'::jsonb),
    'leaves', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employee_id', q.employee_id, 'employee_name', e.full_name,
        'start_date', q.start_date, 'end_date', q.end_date
      ) order by q.start_date)
      from public.schedule_requests q
      join public.employees e on e.id = q.employee_id
      join public.employee_branches eb on eb.employee_id = q.employee_id and eb.branch_id = p_branch_id
      where q.kind = 'leave' and q.status = 'approved'
        and daterange(q.start_date, q.end_date, '[]') && daterange(p_week_start, p_week_start + 6, '[]')
    ), '[]'::jsonb)
  );
end;
$$;

-- Đồng nghiệp đang làm ở chi nhánh (để chọn người đổi/nhường ca)
create or replace function public.branch_colleagues(p_branch_id uuid)
returns table (id uuid, full_name text)
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.manages_branch(p_branch_id) and not private.in_my_branch(p_branch_id) then
    raise exception 'Bạn không thuộc chi nhánh này.' using errcode = '42501';
  end if;
  return query
  select e.id, e.full_name
  from public.employees e
  join public.employee_branches eb on eb.employee_id = e.id and eb.branch_id = p_branch_id
  where e.is_active and e.role <> 'admin'
  order by e.sort_order, e.full_name;
end;
$$;

-- Đơn của tôi + đơn đổi ca gửi đến tôi (kèm tên, thông tin ca)
create or replace function public.my_schedule_requests()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'kind', q.kind, 'status', q.status,
    'employee_id', q.employee_id, 'employee_name', e.full_name,
    'target_employee_id', q.target_employee_id, 'target_name', te.full_name,
    'start_date', q.start_date, 'end_date', q.end_date,
    'requested_time', to_char(q.requested_time, 'HH24:MI'),
    'shift', case when s.id is not null then jsonb_build_object(
      'work_date', s.work_date, 'start_time', to_char(s.start_time, 'HH24:MI'), 'end_time', to_char(s.end_time, 'HH24:MI'),
      'branch_name', b.name) end,
    'target_shift', case when ts.id is not null then jsonb_build_object(
      'work_date', ts.work_date, 'start_time', to_char(ts.start_time, 'HH24:MI'), 'end_time', to_char(ts.end_time, 'HH24:MI')) end,
    'reason', q.reason, 'is_urgent', q.is_urgent, 'over_limit', q.over_limit, 'is_paid', q.is_paid,
    'review_note', q.review_note, 'reviewer_name', rv.full_name, 'reviewed_at', q.reviewed_at,
    'created_at', q.created_at
  ) order by q.created_at desc), '[]'::jsonb)
  from public.schedule_requests q
  join public.employees e on e.id = q.employee_id
  left join public.employees te on te.id = q.target_employee_id
  left join public.employees rv on rv.id = q.reviewed_by
  left join public.shifts s on s.id = q.shift_id
  left join public.branches b on b.id = s.branch_id
  left join public.shifts ts on ts.id = q.target_shift_id
  where (q.employee_id = private.current_employee_id() or q.target_employee_id = private.current_employee_id())
    and q.created_at > now() - interval '120 days'
$$;

revoke all on function public.branch_week_schedule(uuid, date) from public, anon;
revoke all on function public.branch_colleagues(uuid) from public, anon;
revoke all on function public.my_schedule_requests() from public, anon;
grant execute on function public.branch_week_schedule(uuid, date) to authenticated;
grant execute on function public.branch_colleagues(uuid) to authenticated;
grant execute on function public.my_schedule_requests() to authenticated;

-- ---------------------------------------------------------------------
-- 10. TÍNH LƯƠNG — thêm lịch làm việc & đơn xin phép
-- ---------------------------------------------------------------------
create or replace function private.compute_payslip(p_employee_id uuid, p_period_start date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_emp       public.employees;
  v_prof      public.payroll_profiles;
  v_set       public.payroll_settings;
  v_end       date;
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
  v_end   := private.payroll_period_end(v_prof.pay_period, p_period_start);
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
  if v_end >= v_today then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('blocking', true, 'message', 'Kỳ lương chưa kết thúc — đây là số tạm tính.'));
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

revoke all on function private.compute_payslip(uuid, date) from public;
