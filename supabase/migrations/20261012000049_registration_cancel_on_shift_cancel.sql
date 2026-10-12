-- =====================================================================
-- ĐĂNG KÝ CA: CA BỊ HỦY → ĐĂNG KÝ "ĐÃ HỦY", NV ĐĂNG KÝ LẠI ĐƯỢC (12/10/2026)
-- =====================================================================
--   * Ca tạo từ đăng ký bị hủy / ca nháp bị xóa / ca chuyển cho người khác (đổi, nhường ca)
--     → đăng ký gốc chuyển "cancelled" (kèm lý do), không còn chặn trùng giờ.
--   * Đăng ký bị từ chối / đã hủy không chặn đăng ký lại cùng giờ (unique chỉ tính chờ duyệt + đã duyệt).
-- =====================================================================

-- 1. Unique chỉ áp cho đăng ký còn hiệu lực
alter table public.shift_registrations drop constraint shift_registrations_unique;
create unique index shift_registrations_active_unique
  on public.shift_registrations (branch_id, employee_id, work_date, start_time) nulls not distinct
  where status in ('pending', 'approved');

-- 2. Đồng bộ khi ca thay đổi
create or replace function private.shifts_sync_registration()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.shift_registrations set status = 'cancelled', review_note = 'Ca nháp đã bị xóa khỏi lịch.'
    where shift_id = old.id and status = 'approved';
    return old;
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.shift_registrations set status = 'cancelled', review_note = left('Ca đã bị hủy: ' || coalesce(new.cancel_reason, ''), 200)
    where shift_id = new.id and status = 'approved';
  elsif new.employee_id <> old.employee_id then
    update public.shift_registrations set status = 'cancelled', review_note = 'Ca đã chuyển cho người khác (đổi / nhường ca).'
    where shift_id = new.id and status = 'approved';
  end if;
  return new;
end;
$$;
revoke all on function private.shifts_sync_registration() from public;

create trigger shifts_sync_registration
after update of status, employee_id on public.shifts
for each row execute function private.shifts_sync_registration();
create trigger shifts_sync_registration_delete
before delete on public.shifts
for each row execute function private.shifts_sync_registration();

-- Dữ liệu cũ: đăng ký đã duyệt mà ca đã hủy / bị xóa / đã chuyển người
update public.shift_registrations g set status = 'cancelled',
  review_note = case when s.id is null then 'Ca nháp đã bị xóa khỏi lịch.'
                     when s.status = 'cancelled' then left('Ca đã bị hủy: ' || coalesce(s.cancel_reason, ''), 200)
                     else 'Ca đã chuyển cho người khác (đổi / nhường ca).' end
from public.shift_registrations g2
left join public.shifts s on s.id = g2.shift_id
where g.id = g2.id and g.status = 'approved' and g.start_time is not null
  and (s.id is null or s.status = 'cancelled' or s.employee_id <> g.employee_id);

-- 3. Lưu đăng ký: chỉ tính đăng ký còn hiệu lực
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

    v_err := private.registration_time_error(v_st, v_en);
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
