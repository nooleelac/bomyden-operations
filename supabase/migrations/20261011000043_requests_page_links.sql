-- Đơn xin phép tách khỏi Lịch làm việc thành trang riêng /requests → đổi đường dẫn thông báo cho NV.

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
            v_summary || ' · Lý do: ' || left(new.reason, 80) || ' — vào Đơn xin phép để đồng ý / từ chối.',
            '/requests');
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
      values (new.employee_id, 'request_result', new.id, '❌ ' || v_target || ' từ chối ' || lower(left(v_summary, 1)) || substr(v_summary, 2), 'Bạn có thể nhờ người khác.', '/requests');
      v_count := v_count + 1;
    end if;

    -- QL duyệt / từ chối → người gửi (+ người nhận nếu đổi ca được duyệt)
    if old.status = 'pending' and new.status in ('approved', 'rejected') then
      insert into public.notifications (employee_id, kind, ref_id, title, body, url)
      values (new.employee_id, 'request_result', new.id,
              case when new.status = 'approved' then '✅ Đơn đã được duyệt' else '❌ Đơn bị từ chối' end,
              v_summary || coalesce(' — ' || new.review_note, ''),
              '/requests');
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

-- Thông báo cũ về đơn (gửi cho NV) cũng trỏ sang trang mới
update public.notifications set url = '/requests'
 where kind in ('request_peer', 'request_result') and url = '/schedule' and title not like '✅ Đã duyệt %';
