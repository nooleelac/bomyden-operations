-- =====================================================================
-- THÔNG BÁO ĐẨY: ĐƠN XIN PHÉP + ĐĂNG KÝ CA (10/10/2026)
-- =====================================================================
--   * NV gửi đơn (đơn đổi ca: sau khi người nhận đồng ý) → QL chi nhánh + QTV.
--   * Đơn đổi / nhường ca mới → người nhận.  Người nhận từ chối → người gửi.
--   * Đơn được duyệt / từ chối → người gửi (đổi ca được duyệt → cả người nhận).
--   * NV gửi đăng ký ca → QL chi nhánh + QTV (1 thông báo / lần gửi, thay thông báo chưa đọc trước đó).
--   * Duyệt / từ chối đăng ký ca → NV (gộp 1 thông báo / người / lần duyệt).
--   * Đẩy ngay qua Edge Function (pg_net chỉ gửi sau khi transaction commit). Cron mỗi phút là lưới an toàn.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HÀM DÙNG CHUNG
-- ---------------------------------------------------------------------
-- QTV + QL của chi nhánh (branch null → QL có chung chi nhánh với nhân viên), trừ những người trong p_exclude
create or replace function private.schedule_reviewers(p_branch_id uuid, p_employee_id uuid, p_exclude uuid[])
returns table (employee_id uuid)
language sql stable security definer
set search_path = ''
as $$
  select m.id
  from public.employees m
  where m.is_active
    and not coalesce(m.id = any (p_exclude), false)  -- p_exclude có thể chứa NULL
    and (
      m.role = 'admin'
      or (m.role = 'manager' and exists (
        select 1 from public.employee_branches eb
        where eb.employee_id = m.id
          and (
            eb.branch_id = p_branch_id
            or (p_branch_id is null and eb.branch_id in (
              select x.branch_id from public.employee_branches x where x.employee_id = p_employee_id
            ))
          )
      ))
    )
$$;
revoke all on function private.schedule_reviewers(uuid, uuid, uuid[]) from public;

-- Nhãn & mô tả ngắn của đơn: "Xin nghỉ 12/10–13/10", "Xin đi trễ T2 12/10 (vào 09:30)"…
create or replace function private.request_summary(q public.schedule_requests)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_label text := case q.kind
    when 'leave' then 'Xin nghỉ'
    when 'late' then 'Xin đi trễ'
    when 'early_leave' then 'Xin về sớm'
    else case when q.target_shift_id is null then 'Nhường ca' else 'Đổi ca' end
  end;
begin
  if q.kind = 'leave' then
    return v_label || ' ' || to_char(q.start_date, 'DD/MM')
      || case when q.end_date <> q.start_date then '–' || to_char(q.end_date, 'DD/MM') else '' end;
  end if;
  select * into v_shift from public.shifts s where s.id = q.shift_id;
  return v_label || ' ca ' || to_char(v_shift.work_date, 'DD/MM') || ' ' || to_char(v_shift.start_time, 'HH24:MI') || '–' || to_char(v_shift.end_time, 'HH24:MI')
    || case q.kind when 'late' then ' (vào ' || to_char(q.requested_time, 'HH24:MI') || ')'
                   when 'early_leave' then ' (về ' || to_char(q.requested_time, 'HH24:MI') || ')'
                   else '' end;
end;
$$;
revoke all on function private.request_summary(public.schedule_requests) from public;

-- Đẩy ngay các thông báo đang chờ
create or replace function private.push_now()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.call_ops_job('reminders');
exception when others then
  null;  -- không để lỗi gửi đẩy làm hỏng thao tác chính; cron mỗi phút sẽ gửi lại
end;
$$;
revoke all on function private.push_now() from public;

-- ---------------------------------------------------------------------
-- 2. ĐƠN XIN PHÉP (trigger)
-- ---------------------------------------------------------------------
create or replace function private.schedule_requests_notify()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name    text;
  v_target  text;
  v_branch  text;
  v_summary text;
  v_count   integer := 0;
  v_n       integer;
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return null;
  end if;

  select full_name into v_name from public.employees where id = new.employee_id;
  select full_name into v_target from public.employees where id = new.target_employee_id;
  select ' · ' || name into v_branch from public.branches where id = new.branch_id;
  v_summary := private.request_summary(new);

  -- Đơn đổi / nhường ca mới → người nhận
  if tg_op = 'INSERT' and new.status = 'awaiting_peer' then
    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    values (new.target_employee_id, 'request_peer', new.id,
            '🔄 ' || v_name || case when new.target_shift_id is null then ' muốn nhường ca cho bạn' else ' muốn đổi ca với bạn' end,
            v_summary || ' · Lý do: ' || left(new.reason, 80) || ' — vào Lịch làm việc để đồng ý / từ chối.',
            '/schedule');
    v_count := v_count + 1;
  end if;

  -- Đơn chờ duyệt (mới, hoặc người nhận vừa đồng ý đổi ca) → QL + QTV
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status = 'awaiting_peer') then
    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    select r.employee_id, 'request_new', new.id,
           case when new.is_urgent then '🔴 Đơn GẤP: ' else '📝 Đơn mới: ' end || v_name,
           v_summary || coalesce(' với ' || v_target, '') || coalesce(v_branch, '')
             || case when new.over_limit then ' · vượt giới hạn tháng' else '' end
             || ' · Lý do: ' || left(new.reason, 80),
           '/schedule/manage?tab=requests'
    from private.schedule_reviewers(new.branch_id, new.employee_id, array[new.employee_id, new.target_employee_id]) r;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end if;

  if tg_op = 'UPDATE' then
    -- Người nhận từ chối đổi ca → người gửi
    if old.status = 'awaiting_peer' and new.status = 'rejected' then
      insert into public.notifications (employee_id, kind, ref_id, title, body, url)
      values (new.employee_id, 'request_result', new.id, '❌ ' || v_target || ' từ chối ' || lower(left(v_summary, 1)) || substr(v_summary, 2), 'Bạn có thể nhờ người khác.', '/schedule');
      v_count := v_count + 1;
    end if;

    -- QL duyệt / từ chối → người gửi (+ người nhận nếu đổi ca được duyệt)
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      insert into public.notifications (employee_id, kind, ref_id, title, body, url)
      values (new.employee_id, 'request_result', new.id,
              case when new.status = 'approved' then '✅ Đơn đã được duyệt' else '❌ Đơn bị từ chối' end,
              v_summary || coalesce(' — ' || new.review_note, ''),
              '/schedule');
      v_count := v_count + 1;
      if new.status = 'approved' and new.kind = 'swap' then
        insert into public.notifications (employee_id, kind, ref_id, title, body, url)
        values (new.target_employee_id, 'request_result', new.id,
                '✅ Đã duyệt ' || lower(left(v_summary, 1)) || substr(v_summary, 2),
                'Lịch của bạn đã được cập nhật (cùng ' || v_name || ').',
                '/schedule');
        v_count := v_count + 1;
      end if;
    end if;
  end if;

  if v_count > 0 then
    perform private.push_now();
  end if;
  return null;
end;
$$;

create trigger schedule_requests_notify
after insert or update of status on public.schedule_requests
for each row execute function private.schedule_requests_notify();

-- ---------------------------------------------------------------------
-- 3. ĐĂNG KÝ CA
-- ---------------------------------------------------------------------
-- NV vừa gửi đăng ký → QL + QTV (thay thông báo chưa đọc cũ của cùng NV)
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
  select count(*), count(*) filter (where template_id is not null), min(work_date), max(work_date)
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
revoke all on function private.notify_registrations_submitted(uuid, uuid) from public;

-- Kết quả duyệt → từng NV (gộp)
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
           || case when p_approved then '. Ca sẽ hiện trên lịch khi quản lý công bố.'
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
revoke all on function private.notify_registrations_reviewed(uuid[], boolean) from public;

-- Gói lại 2 RPC: chạy bản gốc rồi gửi thông báo
alter function public.save_shift_registrations(uuid, date, date, jsonb) rename to save_shift_registrations_core;
alter function public.review_shift_registrations(uuid[], boolean, text) rename to review_shift_registrations_core;
alter function public.save_shift_registrations_core(uuid, date, date, jsonb) set schema private;
alter function public.review_shift_registrations_core(uuid[], boolean, text) set schema private;
revoke all on function private.save_shift_registrations_core(uuid, date, date, jsonb) from public, anon, authenticated;
revoke all on function private.review_shift_registrations_core(uuid[], boolean, text) from public, anon, authenticated;

create or replace function public.save_shift_registrations(p_branch_id uuid, p_from date, p_to date, p_items jsonb)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_result jsonb := private.save_shift_registrations_core(p_branch_id, p_from, p_to, p_items);
begin
  if (v_result ->> 'saved')::integer > 0 then
    perform private.notify_registrations_submitted(p_branch_id, private.current_employee_id());
  end if;
  return v_result;
end;
$$;

create or replace function public.review_shift_registrations(p_ids uuid[], p_approve boolean, p_note text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_result jsonb := private.review_shift_registrations_core(p_ids, p_approve, p_note);
begin
  if (v_result ->> 'done')::integer > 0 then
    perform private.notify_registrations_reviewed(p_ids, p_approve);
  end if;
  return v_result;
end;
$$;

revoke all on function public.save_shift_registrations(uuid, date, date, jsonb) from public, anon;
revoke all on function public.review_shift_registrations(uuid[], boolean, text) from public, anon;
grant execute on function public.save_shift_registrations(uuid, date, date, jsonb) to authenticated;
grant execute on function public.review_shift_registrations(uuid[], boolean, text) to authenticated;
