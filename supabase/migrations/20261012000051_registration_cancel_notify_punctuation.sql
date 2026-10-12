-- Thông báo hủy ca: thêm dấu chấm sau lý do (đã gộp sẵn vào 20261012000050; file này khớp lịch sử migration trên Supabase)
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
