-- =====================================================================
-- NHÂN VIÊN TỰ ĐĂNG KÝ CA (09/10/2026)
-- =====================================================================
-- Nghiệp vụ đã chốt:
--   * Chỉ NV được bật "Tự đăng ký ca" (thường là part-time). QTV/QL chi nhánh bật/tắt.
--   * NV chọn ca theo mẫu ca (hoặc đánh dấu "Nghỉ") cho từng ngày, xem theo tuần hoặc tháng.
--   * Hạn chót: ngày D chỉ đăng ký / sửa được khi hôm nay <= D - N ngày (N do QTV cài).
--   * QL duyệt → tạo ca NHÁP (vẫn phải Công bố). Từ chối → NV thấy trạng thái.
--   * "Nghỉ" chỉ để QL biết: không phải đơn xin phép, không ảnh hưởng lương.
--   * Xếp nhanh: cho phép tối đa 62 ngày / 5000 ca mỗi lần.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CỜ + CÀI ĐẶT
-- ---------------------------------------------------------------------
alter table public.employees
  add column self_schedule boolean not null default false;
comment on column public.employees.self_schedule is
  'Nhân viên được tự đăng ký ca làm (part-time). QTV/QL chi nhánh bật/tắt.';

alter table public.schedule_settings
  add column register_deadline_days integer not null default 3;
alter table public.schedule_settings add constraint schedule_settings_register_deadline check (
  register_deadline_days between 0 and 60
);

-- ---------------------------------------------------------------------
-- 2. BẢNG ĐĂNG KÝ
-- ---------------------------------------------------------------------
create type public.registration_status as enum ('pending', 'approved', 'rejected');

create table public.shift_registrations (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches (id),
  employee_id uuid not null references public.employees (id),
  work_date   date not null,
  -- null = đăng ký nghỉ ngày này
  template_id uuid references public.shift_templates (id),
  status      public.registration_status not null default 'pending',
  shift_id    uuid references public.shifts (id) on delete set null,
  review_note text,
  reviewed_by uuid references public.employees (id),
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint shift_registrations_unique unique nulls not distinct (branch_id, employee_id, work_date, template_id),
  constraint shift_registrations_note_len check (review_note is null or char_length(review_note) <= 200)
);
create index shift_registrations_branch_date_idx on public.shift_registrations (branch_id, work_date);
create index shift_registrations_employee_idx    on public.shift_registrations (employee_id, work_date);
create index shift_registrations_template_idx    on public.shift_registrations (template_id);
create index shift_registrations_shift_idx       on public.shift_registrations (shift_id);
create index shift_registrations_reviewer_idx    on public.shift_registrations (reviewed_by);

alter table public.shift_registrations enable row level security;
revoke all on public.shift_registrations from anon;
revoke insert, update, delete, truncate on public.shift_registrations from authenticated;

create policy "shift_registrations_select" on public.shift_registrations for select to authenticated
using (
  employee_id = (select private.current_employee_id())
  or (select private.manages_branch(branch_id))
);

create trigger shift_registrations_audit
after insert or update or delete on public.shift_registrations
for each row execute function private.write_audit_log();

-- Ngày sớm nhất còn được đăng ký / sửa
create or replace function private.registration_open_from()
returns date
language sql stable security definer
set search_path = ''
as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date + s.register_deadline_days
  from public.schedule_settings s
$$;
revoke all on function private.registration_open_from() from public;
grant execute on function private.registration_open_from() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. NV: XEM + LƯU ĐĂNG KÝ CỦA MÌNH
-- ---------------------------------------------------------------------
create or replace function public.my_shift_registrations(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'open_from', private.registration_open_from(),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'work_date', r.work_date, 'template_id', r.template_id,
        'status', r.status, 'review_note', r.review_note
      ) order by r.work_date)
      from public.shift_registrations r
      where r.employee_id = private.current_employee_id() and r.branch_id = p_branch_id
        and r.work_date between p_from and p_to
    ), '[]'::jsonb)
  )
$$;

-- p_items: [{ "work_date": "YYYY-MM-DD", "template_id": uuid | null }]
-- Thay toàn bộ đăng ký ĐANG CHỜ của NV trong khoảng ngày còn mở; đăng ký đã duyệt / từ chối giữ nguyên.
create or replace function public.save_shift_registrations(p_branch_id uuid, p_from date, p_to date, p_items jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_emp       uuid := private.current_employee_id();
  v_open_from date := private.registration_open_from();
  v_start     date;
  v_saved     integer := 0;
  v_locked    integer := 0;
  it          jsonb;
  v_date      date;
  v_tpl       uuid;
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
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Dữ liệu không hợp lệ.' using errcode = 'P0001';
  end if;

  v_start := greatest(p_from, v_open_from);

  delete from public.shift_registrations r
  where r.employee_id = v_emp and r.branch_id = p_branch_id and r.status = 'pending'
    and r.work_date between v_start and p_to;

  for it in select * from jsonb_array_elements(p_items)
  loop
    v_date := (it ->> 'work_date')::date;
    v_tpl := nullif(it ->> 'template_id', '')::uuid;
    if v_date < p_from or v_date > p_to then
      continue;
    end if;
    if v_date < v_start then
      v_locked := v_locked + 1;
      continue;
    end if;
    if v_tpl is not null and not exists (
      select 1 from public.shift_templates t where t.id = v_tpl and t.branch_id = p_branch_id and t.is_active
    ) then
      continue;
    end if;
    -- "Nghỉ" bỏ qua nếu cùng ngày đã có đăng ký ca (và ngược lại ca bỏ qua nếu ngày đã đăng ký nghỉ đã duyệt)
    if v_tpl is null and exists (
      select 1 from jsonb_array_elements(p_items) x
      where (x ->> 'work_date')::date = v_date and nullif(x ->> 'template_id', '') is not null
    ) then
      continue;
    end if;
    insert into public.shift_registrations (branch_id, employee_id, work_date, template_id)
    values (p_branch_id, v_emp, v_date, v_tpl)
    on conflict on constraint shift_registrations_unique do nothing;
    if found then
      v_saved := v_saved + 1;
    end if;
  end loop;

  return jsonb_build_object('saved', v_saved, 'locked', v_locked);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. QL: XEM + DUYỆT
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
      'status', r.status, 'review_note', r.review_note, 'created_at', r.created_at
    ) order by r.work_date, e.sort_order, e.full_name)
    from public.shift_registrations r
    join public.employees e on e.id = r.employee_id
    where r.branch_id = p_branch_id and r.work_date between p_from and p_to
  ), '[]'::jsonb);
end;
$$;

create or replace function public.review_shift_registrations(p_ids uuid[], p_approve boolean, p_note text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_done    integer := 0;
  v_skipped integer := 0;
  v_shift   uuid;
  r         record;
begin
  if cardinality(coalesce(p_ids, '{}')) = 0 or cardinality(p_ids) > 5000 then
    raise exception 'Chưa chọn đăng ký nào.' using errcode = 'P0001';
  end if;
  if not p_approve and char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Vui lòng nhập lý do từ chối.' using errcode = 'P0001';
  end if;

  for r in
    select g.id, g.branch_id, g.employee_id, g.work_date, g.template_id, t.start_time, t.end_time
    from public.shift_registrations g
    left join public.shift_templates t on t.id = g.template_id
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

    v_shift := null;
    if r.template_id is not null then
      begin
        insert into public.shifts (branch_id, employee_id, work_date, start_time, end_time, template_id, note)
        values (r.branch_id, r.employee_id, r.work_date, r.start_time, r.end_time, r.template_id, 'Tự đăng ký')
        returning id into v_shift;
      exception when exclusion_violation or raise_exception then
        v_skipped := v_skipped + 1;
        continue;
      end;
    end if;

    update public.shift_registrations set
      status = 'approved', shift_id = v_shift, review_note = nullif(btrim(p_note), ''),
      reviewed_by = private.current_employee_id(), reviewed_at = now()
    where id = r.id;
    v_done := v_done + 1;
  end loop;

  return jsonb_build_object('done', v_done, 'skipped', v_skipped);
end;
$$;

-- Bật / tắt "Tự đăng ký ca" (QTV, hoặc QL cùng chi nhánh)
create or replace function public.set_self_schedule(p_employee_id uuid, p_enabled boolean)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if not private.manages_employee(p_employee_id) then
    raise exception 'Bạn không có quyền với nhân viên này.' using errcode = '42501';
  end if;
  update public.employees set self_schedule = p_enabled
  where id = p_employee_id and role not in ('admin', 'manager');
  if not found then
    raise exception 'Không tìm thấy nhân viên này.' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. XẾP NHANH: NỚI GIỚI HẠN (62 ngày, 5000 ca)
-- ---------------------------------------------------------------------
create or replace function public.bulk_create_shifts(p_branch_id uuid, p_dates date[], p_assignments jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_created integer := 0;
  v_skipped integer := 0;
  v_total   integer;
  a         jsonb;
  t         public.shift_templates;
  v_emp     uuid;
  v_date    date;
begin
  if not private.manages_branch(p_branch_id) then
    raise exception 'Bạn không có quyền xếp lịch chi nhánh này.' using errcode = '42501';
  end if;
  if p_dates is null or cardinality(p_dates) = 0 or cardinality(p_dates) > 62 then
    raise exception 'Chọn từ 1 đến 62 ngày.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments) = 0 then
    raise exception 'Chưa chọn ca / nhân viên nào.' using errcode = 'P0001';
  end if;

  select coalesce(sum(jsonb_array_length(x -> 'employee_ids')), 0) * cardinality(p_dates) into v_total
  from jsonb_array_elements(p_assignments) x;
  if v_total > 5000 then
    raise exception 'Quá nhiều ca trong 1 lần (tối đa 5000). Hãy chia nhỏ khoảng ngày.' using errcode = 'P0001';
  end if;

  for a in select * from jsonb_array_elements(p_assignments)
  loop
    select * into t from public.shift_templates
    where id = (a ->> 'template_id')::uuid and branch_id = p_branch_id and is_active;
    if not found then
      v_skipped := v_skipped + jsonb_array_length(a -> 'employee_ids') * cardinality(p_dates);
      continue;
    end if;

    for v_date in select distinct d from unnest(p_dates) d order by 1
    loop
      for v_emp in select distinct (e #>> '{}')::uuid from jsonb_array_elements(a -> 'employee_ids') e
      loop
        begin
          insert into public.shifts (branch_id, employee_id, work_date, start_time, end_time, template_id)
          values (p_branch_id, v_emp, v_date, t.start_time, t.end_time, t.id);
          v_created := v_created + 1;
        exception when exclusion_violation or raise_exception then
          v_skipped := v_skipped + 1;
        end;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end;
$$;

revoke all on function public.my_shift_registrations(uuid, date, date) from public, anon;
revoke all on function public.save_shift_registrations(uuid, date, date, jsonb) from public, anon;
revoke all on function public.branch_shift_registrations(uuid, date, date) from public, anon;
revoke all on function public.review_shift_registrations(uuid[], boolean, text) from public, anon;
revoke all on function public.set_self_schedule(uuid, boolean) from public, anon;
grant execute on function public.my_shift_registrations(uuid, date, date) to authenticated;
grant execute on function public.save_shift_registrations(uuid, date, date, jsonb) to authenticated;
grant execute on function public.branch_shift_registrations(uuid, date, date) to authenticated;
grant execute on function public.review_shift_registrations(uuid[], boolean, text) to authenticated;
grant execute on function public.set_self_schedule(uuid, boolean) to authenticated;
