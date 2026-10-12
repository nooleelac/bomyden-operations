-- =====================================================================
-- ĐĂNG KÝ CA: NV TỰ CHỌN GIỜ VÀO / RA + ĐỊNH MỨC NHÂN SỰ + PHỦ CA (12/10/2026)
-- =====================================================================
-- Nghiệp vụ đã chốt:
--   * NV tự chọn giờ vào / ra cho từng ca. Mẫu ca chỉ còn là nút chọn nhanh (điền sẵn giờ).
--   * Giới hạn (QTV cài, dùng chung mọi chi nhánh): vào sớm nhất 08:00, ra muộn nhất 01:00 hôm sau,
--     bước 30 phút, 1 ca 3–15 tiếng, tối đa 2 ca/ngày, có 2 ca thì tổng tối đa 14 tiếng.
--   * QL duyệt nguyên giờ hoặc sửa giờ rồi duyệt (từng đăng ký) → ca nháp theo giờ đã duyệt; NV được báo giờ đã chỉnh.
--   * Định mức nhân sự theo khung giờ + thứ (từng chi nhánh). Phủ ca = số ca đã xếp + đăng ký chờ duyệt theo từng ô 30 phút.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CÀI ĐẶT KHUNG GIỜ ĐĂNG KÝ
-- ---------------------------------------------------------------------
alter table public.schedule_settings
  add column register_earliest        time    not null default '08:00',
  add column register_latest          time    not null default '01:00',
  add column register_step_minutes    integer not null default 30,
  add column register_min_minutes     integer not null default 180,
  add column register_max_minutes     integer not null default 900,
  add column register_max_per_day     integer not null default 2,
  add column register_max_day_minutes integer not null default 840;
alter table public.schedule_settings add constraint schedule_settings_register_times check (
  register_step_minutes in (15, 30, 60)
  and register_earliest <> register_latest
  and extract(minute from register_earliest)::integer % register_step_minutes = 0
  and extract(minute from register_latest)::integer % register_step_minutes = 0
  and register_min_minutes between 30 and 960
  and register_max_minutes between register_min_minutes and 960
  and register_max_per_day between 1 and 3
  and register_max_day_minutes between register_min_minutes and 1440
);

-- Phút trong ngày của 1 mốc giờ
create or replace function private.tod_minutes(p_time time)
returns integer
language sql immutable
set search_path = ''
as $$
  select (extract(hour from p_time) * 60 + extract(minute from p_time))::integer
$$;

-- Độ dài ca (phút); giờ ra <= giờ vào → qua đêm
create or replace function private.time_span_minutes(p_start time, p_end time)
returns integer
language sql immutable
set search_path = ''
as $$
  select private.tod_minutes(p_end) - private.tod_minutes(p_start)
    + case when p_end <= p_start then 1440 else 0 end
$$;

-- Mốc ra muộn nhất tính theo phút từ 00:00 ngày làm (01:00 hôm sau = 1500)
create or replace function private.register_window_end(s public.schedule_settings)
returns integer
language sql immutable
set search_path = ''
as $$
  select private.tod_minutes(s.register_latest)
    + case when s.register_latest <= s.register_earliest then 1440 else 0 end
$$;

create or replace function private.hours_label(p_minutes integer)
returns text
language sql immutable
set search_path = ''
as $$
  select replace(trim_scale(round(p_minutes / 60.0, 2))::text, '.', ',') || ' tiếng'
$$;

-- Lỗi của 1 ca tự chọn so với quy định (null = hợp lệ)
create or replace function private.registration_time_error(p_start time, p_end time)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  s     public.schedule_settings;
  v_s   integer := private.tod_minutes(p_start);
  v_dur integer;
begin
  select * into s from public.schedule_settings;
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

revoke all on function private.tod_minutes(time) from public;
revoke all on function private.time_span_minutes(time, time) from public;
revoke all on function private.register_window_end(public.schedule_settings) from public;
revoke all on function private.hours_label(integer) from public;
revoke all on function private.registration_time_error(time, time) from public;
grant execute on function private.tod_minutes(time) to authenticated, service_role;
grant execute on function private.time_span_minutes(time, time) to authenticated, service_role;
grant execute on function private.register_window_end(public.schedule_settings) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. ĐĂNG KÝ LƯU GIỜ TRỰC TIẾP
-- ---------------------------------------------------------------------
alter table public.shift_registrations
  add column start_time          time,
  add column end_time            time,
  add column approved_start_time time,
  add column approved_end_time   time;

update public.shift_registrations g set start_time = t.start_time, end_time = t.end_time
from public.shift_templates t where t.id = g.template_id;
update public.shift_registrations g set approved_start_time = g.start_time, approved_end_time = g.end_time
where g.status = 'approved' and g.start_time is not null;

alter table public.shift_registrations drop constraint shift_registrations_unique;
alter table public.shift_registrations
  add constraint shift_registrations_unique unique nulls not distinct (branch_id, employee_id, work_date, start_time),
  -- start_time null = "Nghỉ" (khi đó không có mẫu ca)
  add constraint shift_registrations_times check (
    (start_time is null) = (end_time is null)
    and (start_time is null or start_time <> end_time)
    and (start_time is not null or template_id is null)
    and (approved_start_time is null) = (approved_end_time is null)
  );

comment on column public.shift_registrations.template_id is
  'Mẫu ca NV bấm chọn nhanh (chỉ tham khảo). Giờ thật nằm ở start_time / end_time.';
comment on column public.shift_registrations.approved_start_time is
  'Giờ vào QL đã duyệt (có thể khác giờ NV xin).';

-- ---------------------------------------------------------------------
-- 3. NV: XEM + LƯU ĐĂNG KÝ
-- ---------------------------------------------------------------------
create or replace function public.my_shift_registrations(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'open_from', private.registration_open_from(),
    'rules', (
      select jsonb_build_object(
        'earliest', to_char(s.register_earliest, 'HH24:MI'), 'latest', to_char(s.register_latest, 'HH24:MI'),
        'step', s.register_step_minutes, 'min', s.register_min_minutes, 'max', s.register_max_minutes,
        'max_per_day', s.register_max_per_day, 'max_day', s.register_max_day_minutes
      ) from public.schedule_settings s
    ),
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

-- p_items: [{ "work_date": "YYYY-MM-DD", "start_time": "HH:MI" | null, "end_time": "HH:MI" | null, "template_id": uuid | null }]
-- start_time null = Nghỉ. Thay toàn bộ đăng ký ĐANG CHỜ của NV trong khoảng ngày còn mở; đã duyệt / từ chối giữ nguyên.
-- Giờ sai quy định → báo lỗi cả lần gửi. Trùng giờ / vượt số ca, tổng giờ trong ngày → bỏ qua và đếm.
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
  select * into s from public.schedule_settings;

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

    -- Nghỉ: bỏ qua nếu cùng ngày có đăng ký ca
    if v_st is null then
      if exists (
        select 1 from jsonb_array_elements(p_items) x
        where (x ->> 'work_date')::date = v_date and nullif(x ->> 'start_time', '') is not null
      ) then
        continue;
      end if;
      insert into public.shift_registrations (branch_id, employee_id, work_date)
      values (p_branch_id, v_emp, v_date)
      on conflict on constraint shift_registrations_unique do nothing;
      if found then
        v_saved := v_saved + 1;
      end if;
      continue;
    end if;

    v_err := private.registration_time_error(v_st, v_en);
    if v_err is not null then
      raise exception 'Ngày %, ca %–%: %', to_char(v_date, 'DD/MM'), to_char(v_st, 'HH24:MI'), to_char(v_en, 'HH24:MI'), v_err
        using errcode = 'P0001';
    end if;

    -- Mẫu ca chỉ giữ lại khi giờ khớp mẫu
    select t.id into v_tpl from public.shift_templates t
    where t.id = nullif(it ->> 'template_id', '')::uuid and t.branch_id = p_branch_id
      and t.start_time = v_st and t.end_time = v_en;

    -- Trùng giờ với đăng ký khác cùng ngày (chưa bị từ chối, mọi chi nhánh)
    if exists (
      select 1 from public.shift_registrations g
      where g.employee_id = v_emp and g.work_date = v_date and g.status <> 'rejected' and g.start_time is not null
        and private.template_range(v_date, coalesce(g.approved_start_time, g.start_time), coalesce(g.approved_end_time, g.end_time))
            && private.template_range(v_date, v_st, v_en)
    ) then
      v_overlap := v_overlap + 1;
      continue;
    end if;

    -- Số ca / tổng giờ trong ngày
    select count(*), coalesce(sum(private.time_span_minutes(coalesce(g.approved_start_time, g.start_time), coalesce(g.approved_end_time, g.end_time))), 0)
    into v_n, v_total
    from public.shift_registrations g
    where g.employee_id = v_emp and g.work_date = v_date and g.status <> 'rejected' and g.start_time is not null;
    if v_n + 1 > s.register_max_per_day
       or (v_n >= 1 and v_total + private.time_span_minutes(v_st, v_en) > s.register_max_day_minutes) then
      v_limit := v_limit + 1;
      continue;
    end if;

    insert into public.shift_registrations (branch_id, employee_id, work_date, template_id, start_time, end_time)
    values (p_branch_id, v_emp, v_date, v_tpl, v_st, v_en)
    on conflict on constraint shift_registrations_unique do nothing;
    if found then
      v_saved := v_saved + 1;
    end if;
  end loop;

  return jsonb_build_object('saved', v_saved, 'locked', v_locked, 'overlap', v_overlap, 'limit', v_limit);
end;
$$;
revoke all on function private.save_shift_registrations_core(uuid, date, date, jsonb) from public, anon, authenticated;

-- Thông báo QL: đếm ca theo giờ (không còn theo mẫu ca)
create or replace function private.notify_registrations_submitted(p_branch_id uuid, p_employee_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_name   text;
  v_branch text;
  v_n      integer;
  v_work   integer;
  v_from   date;
  v_to     date;
begin
  select count(*), count(*) filter (where start_time is not null), min(work_date), max(work_date)
  into v_n, v_work, v_from, v_to
  from public.shift_registrations
  where employee_id = p_employee_id and branch_id = p_branch_id and status = 'pending';
  if v_n = 0 then
    return;
  end if;
  select full_name into v_name from public.employees where id = p_employee_id;
  select name into v_branch from public.branches where id = p_branch_id;

  delete from public.notifications
  where kind = 'registration_new' and ref_id = p_employee_id and read_at is null;

  insert into public.notifications (employee_id, kind, ref_id, title, body, url)
  select r.employee_id, 'registration_new', p_employee_id,
         '🗓️ ' || v_name || ' gửi đăng ký ca',
         v_work || ' ca' || case when v_n > v_work then ', ' || (v_n - v_work) || ' ngày nghỉ' else '' end
           || ' chờ duyệt · ' || to_char(v_from, 'DD/MM')
           || case when v_to <> v_from then '–' || to_char(v_to, 'DD/MM') else '' end || ' · ' || v_branch,
         '/schedule/manage?tab=registrations&branch=' || p_branch_id
  from private.schedule_reviewers(p_branch_id, p_employee_id, array[p_employee_id]) r;

  perform private.push_now();
end;
$$;

-- ---------------------------------------------------------------------
-- 4. QL: XEM + DUYỆT (có thể sửa giờ)
-- ---------------------------------------------------------------------
create or replace function public.branch_shift_registrations(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not private.manages_branch(p_branch_id) then
    raise exception 'Bạn không có quyền xem chi nhánh này.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'employee_id', r.employee_id, 'employee_name', e.full_name,
      'work_date', r.work_date, 'template_id', r.template_id,
      'start_time', to_char(r.start_time, 'HH24:MI'), 'end_time', to_char(r.end_time, 'HH24:MI'),
      'approved_start_time', to_char(r.approved_start_time, 'HH24:MI'), 'approved_end_time', to_char(r.approved_end_time, 'HH24:MI'),
      'status', r.status, 'review_note', r.review_note, 'created_at', r.created_at
    ) order by r.work_date, r.start_time nulls last, e.sort_order, e.full_name)
    from public.shift_registrations r
    join public.employees e on e.id = r.employee_id
    where r.branch_id = p_branch_id and r.work_date between p_from and p_to
  ), '[]'::jsonb);
end;
$$;

drop function public.review_shift_registrations(uuid[], boolean, text);
drop function private.review_shift_registrations_core(uuid[], boolean, text);

-- p_start / p_end: QL sửa giờ (chỉ khi duyệt đúng 1 đăng ký ca)
create or replace function private.review_shift_registrations_core(
  p_ids uuid[], p_approve boolean, p_note text, p_start time, p_end time
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_done    integer := 0;
  v_skipped integer := 0;
  v_shift   uuid;
  v_st      time;
  v_en      time;
  v_tpl     uuid;
  r         record;
begin
  if cardinality(coalesce(p_ids, '{}')) = 0 or cardinality(p_ids) > 5000 then
    raise exception 'Chưa chọn đăng ký nào.' using errcode = 'P0001';
  end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Vui lòng nhập lý do từ chối.' using errcode = 'P0001';
  end if;
  if (p_start is null) <> (p_end is null) then
    raise exception 'Thiếu giờ vào hoặc giờ ra.' using errcode = 'P0001';
  end if;
  if p_start is not null then
    if not p_approve or cardinality(p_ids) <> 1 then
      raise exception 'Chỉ sửa giờ được khi duyệt từng đăng ký.' using errcode = 'P0001';
    end if;
    if p_start = p_end or private.time_span_minutes(p_start, p_end) > 960 then
      raise exception 'Giờ không hợp lệ (ca dài tối đa 16 tiếng).' using errcode = 'P0001';
    end if;
  end if;

  for r in
    select g.id, g.branch_id, g.employee_id, g.work_date, g.template_id, g.start_time, g.end_time
    from public.shift_registrations g
    where g.id = any (p_ids) and g.status = 'pending'
    order by g.work_date
  loop
    if not private.manages_branch(r.branch_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if not p_approve then
      update public.shift_registrations set
        status = 'rejected', review_note = btrim(p_note),
        reviewed_by = private.current_employee_id(), reviewed_at = now()
      where id = r.id;
      v_done := v_done + 1;
      continue;
    end if;

    if p_start is not null and r.start_time is null then
      raise exception 'Đăng ký nghỉ không sửa giờ được.' using errcode = 'P0001';
    end if;
    v_st := coalesce(p_start, r.start_time);
    v_en := coalesce(p_end, r.end_time);

    v_shift := null;
    if v_st is not null then
      v_tpl := null;
      select t.id into v_tpl from public.shift_templates t
      where t.id = r.template_id and t.start_time = v_st and t.end_time = v_en;
      begin
        insert into public.shifts (branch_id, employee_id, work_date, start_time, end_time, template_id, note)
        values (r.branch_id, r.employee_id, r.work_date, v_st, v_en, v_tpl, 'Tự đăng ký')
        returning id into v_shift;
      exception when exclusion_violation or raise_exception then
        v_skipped := v_skipped + 1;
        continue;
      end;
    end if;

    update public.shift_registrations set
      status = 'approved', shift_id = v_shift,
      approved_start_time = v_st, approved_end_time = v_en,
      review_note = nullif(btrim(p_note), ''),
      reviewed_by = private.current_employee_id(), reviewed_at = now()
    where id = r.id;
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object('done', v_done, 'skipped', v_skipped);
end;
$$;
revoke all on function private.review_shift_registrations_core(uuid[], boolean, text, time, time) from public, anon, authenticated;

-- Kết quả duyệt → từng NV (gộp), kèm giờ QL đã chỉnh
create or replace function private.notify_registrations_reviewed(p_ids uuid[], p_approved boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.notifications (employee_id, kind, title, body, url)
  select g.employee_id, 'registration_result',
         case when p_approved then '✅ Đăng ký ca đã được duyệt' else '❌ Đăng ký ca bị từ chối' end,
         count(*) || ' đăng ký · ' || to_char(min(g.work_date), 'DD/MM')
           || case when max(g.work_date) <> min(g.work_date) then '–' || to_char(max(g.work_date), 'DD/MM') else '' end
           || case when p_approved then
                coalesce(' · Quản lý chỉnh giờ: ' || string_agg(
                  case when g.approved_start_time is distinct from g.start_time or g.approved_end_time is distinct from g.end_time
                    then to_char(g.work_date, 'DD/MM') || ' ' || to_char(g.approved_start_time, 'HH24:MI') || '–' || to_char(g.approved_end_time, 'HH24:MI')
                  end, ', ' order by g.work_date), '')
                || '. Ca sẽ hiện trên lịch khi quản lý công bố.'
              else coalesce(' — ' || max(g.review_note), '') end,
         '/schedule/register?mode=month&start=' || to_char(min(g.work_date), 'YYYY-MM')
  from public.shift_registrations g
  where g.id = any (p_ids)
    and g.status = case when p_approved then 'approved'::public.registration_status else 'rejected'::public.registration_status end
    and g.reviewed_at = now()
  group by g.employee_id;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.push_now();
  end if;
end;
$$;

create or replace function public.review_shift_registrations(
  p_ids uuid[], p_approve boolean, p_note text default null, p_start time default null, p_end time default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_result jsonb := private.review_shift_registrations_core(p_ids, p_approve, p_note, p_start, p_end);
begin
  if (v_result ->> 'done')::integer > 0 then
    perform private.notify_registrations_reviewed(p_ids, p_approve);
  end if;
  return v_result;
end;
$$;
revoke all on function public.review_shift_registrations(uuid[], boolean, text, time, time) from public, anon;
grant execute on function public.review_shift_registrations(uuid[], boolean, text, time, time) to authenticated;

-- ---------------------------------------------------------------------
-- 5. ĐỊNH MỨC NHÂN SỰ THEO KHUNG GIỜ
-- ---------------------------------------------------------------------
create table public.staffing_requirements (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches (id) on delete cascade,
  -- 0 = CN … 6 = T7
  weekdays   smallint[] not null,
  start_time time not null,
  end_time   time not null,
  headcount  integer not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees (id),
  constraint staffing_requirements_weekdays check (cardinality(weekdays) between 1 and 7 and weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]),
  constraint staffing_requirements_times check (start_time <> end_time),
  constraint staffing_requirements_headcount check (headcount between 1 and 50)
);
create index staffing_requirements_branch_idx     on public.staffing_requirements (branch_id);
create index staffing_requirements_created_by_idx on public.staffing_requirements (created_by);
create index staffing_requirements_updated_by_idx on public.staffing_requirements (updated_by);

create or replace function private.staffing_requirements_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.branch_id <> old.branch_id then
    raise exception 'Không được chuyển định mức sang chi nhánh khác.' using errcode = 'P0001';
  end if;
  new.weekdays := (select array_agg(distinct w order by w) from unnest(new.weekdays) w);
  return new;
end;
$$;

create trigger staffing_requirements_guard
before insert or update on public.staffing_requirements
for each row execute function private.staffing_requirements_guard();
create trigger staffing_requirements_stamp
before insert or update on public.staffing_requirements
for each row execute function private.stamp_row();
create trigger staffing_requirements_audit
after insert or update or delete on public.staffing_requirements
for each row execute function private.write_audit_log();

alter table public.staffing_requirements enable row level security;
revoke all on public.staffing_requirements from anon;
revoke truncate on public.staffing_requirements from authenticated;

create policy "staffing_requirements_select" on public.staffing_requirements for select to authenticated
using ((select private.manages_branch(branch_id)) or (select private.in_my_branch(branch_id)));
create policy "staffing_requirements_insert" on public.staffing_requirements for insert to authenticated
with check ((select private.manages_branch(branch_id)));
create policy "staffing_requirements_update" on public.staffing_requirements for update to authenticated
using ((select private.manages_branch(branch_id))) with check ((select private.manages_branch(branch_id)));
create policy "staffing_requirements_delete" on public.staffing_requirements for delete to authenticated
using ((select private.manages_branch(branch_id)));

alter publication supabase_realtime add table public.staffing_requirements;

-- ---------------------------------------------------------------------
-- 6. PHỦ CA THEO TỪNG Ô GIỜ
-- ---------------------------------------------------------------------
-- Mỗi ngày: mảng theo ô (bước = register_step_minutes, từ giờ vào sớm nhất đến giờ ra muộn nhất):
--   need = định mức, scheduled = ca đã xếp (nháp + công bố), pending = đăng ký chờ duyệt.
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
  select * into s from public.schedule_settings;
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
