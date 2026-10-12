-- =====================================================================
-- ĐĂNG KÝ CA: KHUNG GIỜ RIÊNG TỪNG CHI NHÁNH + BÁO NV KHI CA ĐĂNG KÝ BỊ HỦY (12/10/2026)
-- =====================================================================
--   * Mặc định dùng quy định chung (schedule_settings). QTV đặt riêng cho chi nhánh nào thì chi nhánh đó
--     dùng bảng branch_register_rules (xóa dòng = quay về mặc định).
--   * Ca tạo từ đăng ký bị hủy / ca nháp bị xóa → thông báo đẩy cho NV (kèm lý do, link đăng ký lại).
--     Ca chuyển người qua đơn đổi / nhường ca: không báo thêm (đã có thông báo kết quả đơn).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BẢNG QUY ĐỊNH RIÊNG
-- ---------------------------------------------------------------------
create table public.branch_register_rules (
  id                       uuid primary key default gen_random_uuid(),
  branch_id                uuid not null unique references public.branches (id) on delete cascade,
  register_earliest        time    not null,
  register_latest          time    not null,
  register_step_minutes    integer not null,
  register_min_minutes     integer not null,
  register_max_minutes     integer not null,
  register_max_per_day     integer not null,
  register_max_day_minutes integer not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees (id),
  constraint branch_register_rules_values check (
    register_step_minutes in (15, 30, 60)
    and register_earliest <> register_latest
    and extract(minute from register_earliest)::integer % register_step_minutes = 0
    and extract(minute from register_latest)::integer % register_step_minutes = 0
    and register_min_minutes between 30 and 960
    and register_max_minutes between register_min_minutes and 960
    and register_max_per_day between 1 and 3
    and register_max_day_minutes between register_min_minutes and 1440
  )
);
create index branch_register_rules_created_by_idx on public.branch_register_rules (created_by);
create index branch_register_rules_updated_by_idx on public.branch_register_rules (updated_by);

create trigger branch_register_rules_stamp
before insert or update on public.branch_register_rules
for each row execute function private.stamp_row();
create trigger branch_register_rules_audit
after insert or update or delete on public.branch_register_rules
for each row execute function private.write_audit_log();

alter table public.branch_register_rules enable row level security;
revoke all on public.branch_register_rules from anon;
revoke truncate on public.branch_register_rules from authenticated;

create policy "branch_register_rules_select" on public.branch_register_rules for select to authenticated
using ((select private.current_employee_id()) is not null);
create policy "branch_register_rules_insert" on public.branch_register_rules for insert to authenticated
with check ((select private.is_admin()));
create policy "branch_register_rules_update" on public.branch_register_rules for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "branch_register_rules_delete" on public.branch_register_rules for delete to authenticated
using ((select private.is_admin()));

alter publication supabase_realtime add table public.branch_register_rules;

-- Quy định áp dụng cho 1 chi nhánh (mặc định + ghi đè)
create or replace function private.branch_register_settings(p_branch_id uuid)
returns public.schedule_settings
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s public.schedule_settings;
  b public.branch_register_rules;
begin
  select * into s from public.schedule_settings;
  select * into b from public.branch_register_rules r where r.branch_id = p_branch_id;
  if b.id is not null then
    s.register_earliest := b.register_earliest;
    s.register_latest := b.register_latest;
    s.register_step_minutes := b.register_step_minutes;
    s.register_min_minutes := b.register_min_minutes;
    s.register_max_minutes := b.register_max_minutes;
    s.register_max_per_day := b.register_max_per_day;
    s.register_max_day_minutes := b.register_max_day_minutes;
  end if;
  return s;
end;
$$;

create or replace function private.register_rules_json(s public.schedule_settings)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'earliest', to_char(s.register_earliest, 'HH24:MI'), 'latest', to_char(s.register_latest, 'HH24:MI'),
    'step', s.register_step_minutes, 'min', s.register_min_minutes, 'max', s.register_max_minutes,
    'max_per_day', s.register_max_per_day, 'max_day', s.register_max_day_minutes
  )
$$;
revoke all on function private.branch_register_settings(uuid) from public;
revoke all on function private.register_rules_json(public.schedule_settings) from public;

-- Quy định của chi nhánh cho trang QL
create or replace function public.branch_register_rules_of(p_branch_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (private.manages_branch(p_branch_id) or private.in_my_branch(p_branch_id)) then
    raise exception 'Bạn không có quyền xem chi nhánh này.' using errcode = '42501';
  end if;
  return private.register_rules_json(private.branch_register_settings(p_branch_id));
end;
$$;
revoke all on function public.branch_register_rules_of(uuid) from public, anon;
grant execute on function public.branch_register_rules_of(uuid) to authenticated;

-- Kiểm tra giờ theo quy định của chi nhánh
create or replace function private.registration_time_error(p_branch_id uuid, p_start time, p_end time)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s     public.schedule_settings := private.branch_register_settings(p_branch_id);
  v_s   integer := private.tod_minutes(p_start);
  v_dur integer;
begin
  if p_start = p_end then
    return 'giờ vào và giờ ra trùng nhau.';
  end if;
  v_dur := private.time_span_minutes(p_start, p_end);
  if v_s % s.register_step_minutes <> 0 or private.tod_minutes(p_end) % s.register_step_minutes <> 0
     or extract(second from p_start) <> 0 or extract(second from p_end) <> 0 then
    return 'giờ phải tròn ' || s.register_step_minutes || ' phút.';
  end if;
  if v_s < private.tod_minutes(s.register_earliest) or v_s + v_dur > private.register_window_end(s) then
    return 'ngoài khung giờ cho phép (' || to_char(s.register_earliest, 'HH24:MI') || '–' || to_char(s.register_latest, 'HH24:MI') || ').';
  end if;
  if v_dur < s.register_min_minutes then
    return 'ca ngắn hơn ' || private.hours_label(s.register_min_minutes) || '.';
  end if;
  if v_dur > s.register_max_minutes then
    return 'ca dài hơn ' || private.hours_label(s.register_max_minutes) || '.';
  end if;
  return null;
end;
$$;
revoke all on function private.registration_time_error(uuid, time, time) from public;

-- ---------------------------------------------------------------------
-- 2. CÁC HÀM DÙNG QUY ĐỊNH THEO CHI NHÁNH
-- ---------------------------------------------------------------------

create or replace function public.my_shift_registrations(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'open_from', private.registration_open_from(),
    'rules', private.register_rules_json(private.branch_register_settings(p_branch_id)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'work_date', r.work_date, 'template_id', r.template_id,
        'start_time', to_char(r.start_time, 'HH24:MI'), 'end_time', to_char(r.end_time, 'HH24:MI'),
        'approved_start_time', to_char(r.approved_start_time, 'HH24:MI'), 'approved_end_time', to_char(r.approved_end_time, 'HH24:MI'),
        'status', r.status, 'review_note', r.review_note
      ) order by r.work_date, r.start_time nulls last)
      from public.shift_registrations r
      where r.employee_id = private.current_employee_id() and r.branch_id = p_branch_id
        and r.work_date between p_from and p_to
    ), '[]'::jsonb)
  )
$$;

create or replace function private.save_shift_registrations_core(p_branch_id uuid, p_from date, p_to date, p_items jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_emp       uuid := private.current_employee_id();
  v_open_from date := private.registration_open_from();
  s           public.schedule_settings;
  v_start     date;
  v_saved     integer := 0;
  v_locked    integer := 0;
  v_overlap   integer := 0;
  v_limit     integer := 0;
  it          jsonb;
  v_date      date;
  v_st        time;
  v_en        time;
  v_tpl       uuid;
  v_err       text;
  v_n         integer;
  v_total     integer;
begin
  if v_emp is null or not exists (
    select 1 from public.employees e where e.id = v_emp and e.is_active and e.self_schedule
  ) then
    raise exception 'Bạn chưa được bật quyền tự đăng ký ca. Hãy hỏi quản lý.' using errcode = '42501';
  end if;
  if not private.in_my_branch(p_branch_id) then
    raise exception 'Bạn không thuộc chi nhánh này.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Khoảng ngày không hợp lệ (tối đa 2 tháng).' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 63 * 4 then
    raise exception 'Dữ liệu không hợp lệ.' using errcode = 'P0001';
  end if;
  s := private.branch_register_settings(p_branch_id);

  v_start := greatest(p_from, v_open_from);

  delete from public.shift_registrations r
  where r.employee_id = v_emp and r.branch_id = p_branch_id and r.status = 'pending'
    and r.work_date between v_start and p_to;

  for it in
    select x from jsonb_array_elements(p_items) x
    order by x ->> 'work_date', nullif(x ->> 'start_time', '') nulls last
  loop
    v_date := (it ->> 'work_date')::date;
    v_st := nullif(it ->> 'start_time', '')::time;
    v_en := nullif(it ->> 'end_time', '')::time;
    if v_date < p_from or v_date > p_to then
      continue;
    end if;
    if v_date < v_start then
      v_locked := v_locked + 1;
      continue;
    end if;
    if (v_st is null) <> (v_en is null) then
      raise exception 'Ngày %: thiếu giờ vào hoặc giờ ra.', to_char(v_date, 'DD/MM') using errcode = 'P0001';
    end if;

    if v_st is null then
      if exists (
        select 1 from jsonb_array_elements(p_items) x
        where (x ->> 'work_date')::date = v_date and nullif(x ->> 'start_time', '') is not null
      ) then
        continue;
      end if;
      insert into public.shift_registrations (branch_id, employee_id, work_date)
      values (p_branch_id, v_emp, v_date)
      on conflict (branch_id, employee_id, work_date, start_time) where status in ('pending', 'approved') do nothing;
      if found then
        v_saved := v_saved + 1;
      end if;
      continue;
    end if;

    v_err := private.registration_time_error(p_branch_id, v_st, v_en);
    if v_err is not null then
      raise exception 'Ngày %, ca %–%: %', to_char(v_date, 'DD/MM'), to_char(v_st, 'HH24:MI'), to_char(v_en, 'HH24:MI'), v_err
        using errcode = 'P0001';
    end if;

    select t.id into v_tpl from public.shift_templates t
    where t.id = nullif(it ->> 'template_id', '')::uuid and t.branch_id = p_branch_id
      and t.start_time = v_st and t.end_time = v_en;

    if exists (
      select 1 from public.shift_registrations g
      where g.employee_id = v_emp and g.work_date = v_date and g.status in ('pending', 'approved') and g.start_time is not null
        and private.template_range(v_date, coalesce(g.approved_start_time, g.start_time), coalesce(g.approved_end_time, g.end_time))
            && private.template_range(v_date, v_st, v_en)
    ) then
      v_overlap := v_overlap + 1;
      continue;
    end if;

    select count(*), coalesce(sum(private.time_span_minutes(coalesce(g.approved_start_time, g.start_time), coalesce(g.approved_end_time, g.end_time))), 0)
    into v_n, v_total
    from public.shift_registrations g
    where g.employee_id = v_emp and g.work_date = v_date and g.status in ('pending', 'approved') and g.start_time is not null;
    if v_n + 1 > s.register_max_per_day
       or (v_n >= 1 and v_total + private.time_span_minutes(v_st, v_en) > s.register_max_day_minutes) then
      v_limit := v_limit + 1;
      continue;
    end if;

    insert into public.shift_registrations (branch_id, employee_id, work_date, template_id, start_time, end_time)
    values (p_branch_id, v_emp, v_date, v_tpl, v_st, v_en)
    on conflict (branch_id, employee_id, work_date, start_time) where status in ('pending', 'approved') do nothing;
    if found then
      v_saved := v_saved + 1;
    end if;
  end loop;

  return jsonb_build_object('saved', v_saved, 'locked', v_locked, 'overlap', v_overlap, 'limit', v_limit);
end;
$$;
revoke all on function private.save_shift_registrations_core(uuid, date, date, jsonb) from public, anon, authenticated;

create or replace function public.branch_coverage(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s      public.schedule_settings;
  v_e    integer;
  v_l    integer;
  v_step integer;
begin
  if not (private.manages_branch(p_branch_id) or private.in_my_branch(p_branch_id)) then
    raise exception 'Bạn không có quyền xem chi nhánh này.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Khoảng ngày không hợp lệ (tối đa 2 tháng).' using errcode = 'P0001';
  end if;
  s := private.branch_register_settings(p_branch_id);
  v_e := private.tod_minutes(s.register_earliest);
  v_l := private.register_window_end(s);
  v_step := s.register_step_minutes;

  return jsonb_build_object(
    'start', v_e,
    'step', v_step,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('date', z.d, 'need', z.need, 'scheduled', z.sched, 'pending', z.pend) order by z.d)
      from (
        select dd.d,
               array_agg(c.need order by t) as need,
               array_agg(c.sched order by t) as sched,
               array_agg(c.pend order by t) as pend
        from (select g::date as d from generate_series(p_from, p_to, interval '1 day') g) dd
        cross join generate_series(v_e, v_l - v_step, v_step) t
        cross join lateral (
          select
            coalesce((
              select max(q.headcount)
              from public.staffing_requirements q
              cross join lateral (
                select private.tod_minutes(q.start_time)
                  + case when private.tod_minutes(q.start_time) < v_e then 1440 else 0 end as qs
              ) qq
              where q.branch_id = p_branch_id
                and extract(dow from dd.d)::smallint = any (q.weekdays)
                and qq.qs <= t and qq.qs + private.time_span_minutes(q.start_time, q.end_time) >= t + v_step
            ), 0) as need,
            (
              select count(*)
              from public.shifts x
              where x.branch_id = p_branch_id and x.work_date = dd.d and x.status <> 'cancelled'
                and private.tod_minutes(x.start_time) < t + v_step
                and private.tod_minutes(x.start_time) + private.time_span_minutes(x.start_time, x.end_time) > t
            ) as sched,
            (
              select count(*)
              from public.shift_registrations g
              where g.branch_id = p_branch_id and g.work_date = dd.d and g.status = 'pending' and g.start_time is not null
                and private.tod_minutes(g.start_time) < t + v_step
                and private.tod_minutes(g.start_time) + private.time_span_minutes(g.start_time, g.end_time) > t
            ) as pend
        ) c
        group by dd.d
      ) z
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.branch_coverage(uuid, date, date) from public, anon;
grant execute on function public.branch_coverage(uuid, date, date) to authenticated;

drop function private.registration_time_error(time, time);

-- ---------------------------------------------------------------------
-- 3. CA BỊ HỦY / XÓA → ĐĂNG KÝ "ĐÃ HỦY" + BÁO NV
-- ---------------------------------------------------------------------
create or replace function private.shifts_sync_registration()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_note   text;
  v_notify boolean := true;
  v_count  integer;
begin
  if tg_op = 'DELETE' then
    v_id := old.id;
    v_note := 'Ca nháp đã bị xóa khỏi lịch.';
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    v_id := new.id;
    v_note := left('Ca đã bị hủy: ' || coalesce(new.cancel_reason, ''), 200);
  elsif new.employee_id <> old.employee_id then
    v_id := new.id;
    v_note := 'Ca đã chuyển cho người khác (đổi / nhường ca).';
    v_notify := false;
  else
    return new;
  end if;

  with u as (
    update public.shift_registrations set status = 'cancelled', review_note = v_note
    where shift_id = v_id and status = 'approved'
    returning id, employee_id, work_date, approved_start_time, approved_end_time
  )
  insert into public.notifications (employee_id, kind, ref_id, title, body, url)
  select u.employee_id, 'registration_result', u.id,
         '🚫 Ca đăng ký đã bị hủy',
         to_char(u.work_date, 'DD/MM') || ' ' || to_char(u.approved_start_time, 'HH24:MI') || '–' || to_char(u.approved_end_time, 'HH24:MI')
           || ' · ' || rtrim(v_note, '.') || '. Bạn có thể đăng ký lại hoặc liên hệ quản lý.',
         '/schedule/register?mode=week&start=' || to_char(u.work_date - (extract(isodow from u.work_date)::integer - 1), 'YYYY-MM-DD')
  from u
  where v_notify;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.push_now();
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.shifts_sync_registration() from public;
