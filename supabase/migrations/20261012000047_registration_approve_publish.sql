-- =====================================================================
-- ĐĂNG KÝ CA: NÚT "DUYỆT & CÔNG BỐ" (12/10/2026)
-- =====================================================================
--   * p_publish = true → ca tạo ra ở trạng thái Đã công bố (NV thấy ngay), không cần bấm Công bố cả tuần.
--   * Thông báo cho NV ghi rõ ca đã có trên lịch hay đang chờ công bố.
-- =====================================================================

drop function public.review_shift_registrations(uuid[], boolean, text, time, time);
drop function private.review_shift_registrations_core(uuid[], boolean, text, time, time);

create or replace function private.review_shift_registrations_core(
  p_ids uuid[], p_approve boolean, p_note text, p_start time, p_end time, p_publish boolean
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
        insert into public.shifts (branch_id, employee_id, work_date, start_time, end_time, template_id, note, status)
        values (r.branch_id, r.employee_id, r.work_date, v_st, v_en, v_tpl, 'Tự đăng ký',
                case when coalesce(p_publish, false) then 'published'::public.shift_status else 'draft'::public.shift_status end)
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
revoke all on function private.review_shift_registrations_core(uuid[], boolean, text, time, time, boolean) from public, anon, authenticated;

-- Kết quả duyệt → từng NV (gộp), kèm giờ QL đã chỉnh + ca đã lên lịch hay chờ công bố
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
                || case when bool_or(s.status = 'draft') then '. Ca sẽ hiện trên lịch khi quản lý công bố.'
                        else '. Ca đã có trên Lịch làm việc.' end
              else coalesce(' — ' || max(g.review_note), '') end,
         case when p_approved and not coalesce(bool_or(s.status = 'draft'), false)
              then '/schedule?week=' || to_char(min(g.work_date) - (extract(isodow from min(g.work_date))::integer - 1), 'YYYY-MM-DD')
              else '/schedule/register?mode=month&start=' || to_char(min(g.work_date), 'YYYY-MM') end
  from public.shift_registrations g
  left join public.shifts s on s.id = g.shift_id
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
  p_ids uuid[], p_approve boolean, p_note text default null, p_start time default null, p_end time default null,
  p_publish boolean default false
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_result jsonb := private.review_shift_registrations_core(p_ids, p_approve, p_note, p_start, p_end, p_publish);
begin
  if (v_result ->> 'done')::integer > 0 then
    perform private.notify_registrations_reviewed(p_ids, p_approve);
  end if;
  return v_result;
end;
$$;
revoke all on function public.review_shift_registrations(uuid[], boolean, text, time, time, boolean) from public, anon;
grant execute on function public.review_shift_registrations(uuid[], boolean, text, time, time, boolean) to authenticated;
