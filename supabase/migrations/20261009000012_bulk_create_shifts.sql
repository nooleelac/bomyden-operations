-- =====================================================================
-- XẾP NHANH THEO CA (09/10/2026)
-- =====================================================================
-- QTV/QL chọn nhiều ngày + mỗi mẫu ca tick nhiều nhân viên → tạo hàng loạt ca nháp trong 1 lần.
-- Giờ ca lấy từ mẫu ca. Ca trùng giờ / NV không còn ở chi nhánh / mẫu ca đã tắt → bỏ qua, đếm "skipped".
-- p_assignments: [{ "template_id": uuid, "employee_ids": [uuid, ...] }, ...]
-- =====================================================================

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
  if p_dates is null or cardinality(p_dates) = 0 or cardinality(p_dates) > 31 then
    raise exception 'Chọn từ 1 đến 31 ngày.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_assignments) is distinct from 'array' or jsonb_array_length(p_assignments) = 0 then
    raise exception 'Chưa chọn ca / nhân viên nào.' using errcode = 'P0001';
  end if;

  select coalesce(sum(jsonb_array_length(x -> 'employee_ids')), 0) * cardinality(p_dates) into v_total
  from jsonb_array_elements(p_assignments) x;
  if v_total > 2000 then
    raise exception 'Quá nhiều ca trong 1 lần (tối đa 2000). Hãy chia nhỏ.' using errcode = 'P0001';
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

revoke all on function public.bulk_create_shifts(uuid, date[], jsonb) from public, anon;
grant execute on function public.bulk_create_shifts(uuid, date[], jsonb) to authenticated;
