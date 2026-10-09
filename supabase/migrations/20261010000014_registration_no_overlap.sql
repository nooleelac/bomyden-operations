-- =====================================================================
-- ĐĂNG KÝ CA: KHÔNG CHO CHỌN CÁC CA TRÙNG GIỜ TRONG CÙNG NGÀY (10/10/2026)
-- =====================================================================
-- Một ngày NV được đăng ký nhiều ca, miễn giờ không chồng lên nhau
-- (so với đăng ký khác cùng ngày chưa bị từ chối, ở mọi chi nhánh). Ca trùng → bỏ qua, đếm "overlap".
-- =====================================================================

-- Khoảng giờ của mẫu ca trong 1 ngày (ca qua đêm kết thúc hôm sau)
create or replace function private.template_range(p_date date, p_start time, p_end time)
returns tsrange
language sql immutable
set search_path = ''
as $$
  select tsrange(p_date + p_start, p_date + p_end + case when p_end <= p_start then interval '1 day' else interval '0' end, '[)')
$$;

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
  v_overlap   integer := 0;
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
    -- "Nghỉ" bỏ qua nếu cùng ngày có đăng ký ca
    if v_tpl is null and exists (
      select 1 from jsonb_array_elements(p_items) x
      where (x ->> 'work_date')::date = v_date and nullif(x ->> 'template_id', '') is not null
    ) then
      continue;
    end if;
    -- Ca trùng giờ với ca đã đăng ký cùng ngày → bỏ qua
    if v_tpl is not null and exists (
      select 1
      from public.shift_registrations g
      join public.shift_templates t2 on t2.id = g.template_id
      cross join public.shift_templates t1
      where t1.id = v_tpl
        and g.employee_id = v_emp and g.work_date = v_date and g.status <> 'rejected' and g.template_id <> v_tpl
        and private.template_range(v_date, t1.start_time, t1.end_time) && private.template_range(v_date, t2.start_time, t2.end_time)
    ) then
      v_overlap := v_overlap + 1;
      continue;
    end if;
    insert into public.shift_registrations (branch_id, employee_id, work_date, template_id)
    values (p_branch_id, v_emp, v_date, v_tpl)
    on conflict on constraint shift_registrations_unique do nothing;
    if found then
      v_saved := v_saved + 1;
    end if;
  end loop;

  return jsonb_build_object('saved', v_saved, 'locked', v_locked, 'overlap', v_overlap);
end;
$$;
