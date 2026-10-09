-- =====================================================================
-- NHẮC NV TỰ ĐĂNG KÝ CA CHƯA ĐĂNG KÝ TUẦN TỚI (10/10/2026)
-- =====================================================================
-- Chủ nhật 15:00 giờ VN (08:00 UTC). Nhắc NV đang bật "Tự đăng ký ca" mà chưa có đăng ký nào
-- (bất kỳ trạng thái) trong tuần tới (T2–CN). Nếu cả tuần đã quá hạn đăng ký thì không nhắc.
-- =====================================================================

-- Đã chạy riêng trước (giá trị enum mới phải commit trước khi dùng):
-- alter type public.notification_kind add value if not exists 'registration_reminder';

create or replace function private.remind_unregistered_shifts()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_today date := private.vn_today();
  v_week  date;
  v_open  date := private.registration_open_from();
  v_count integer;
begin
  v_week := v_today + (8 - extract(isodow from v_today)::integer);  -- thứ Hai tuần tới
  if v_open > v_week + 6 then
    return 0;
  end if;

  insert into public.notifications (employee_id, kind, title, body, url)
  select e.id, 'registration_reminder',
         '🗓️ Nhớ đăng ký ca tuần tới',
         'Tuần ' || to_char(v_week, 'DD/MM') || '–' || to_char(v_week + 6, 'DD/MM') || ': bạn chưa đăng ký ca nào.'
           || case when v_open > v_week then ' Đăng ký được từ ' || to_char(v_open, 'DD/MM') || '.' else '' end,
         '/schedule/register?mode=week&start=' || v_week
  from public.employees e
  where e.is_active and e.self_schedule
    and exists (
      select 1 from public.employee_branches eb join public.branches b on b.id = eb.branch_id and b.is_active
      where eb.employee_id = e.id
    )
    and not exists (
      select 1 from public.shift_registrations g
      where g.employee_id = e.id and g.work_date between v_week and v_week + 6
    )
    -- chống nhắc trùng nếu job chạy lại trong ngày
    and not exists (
      select 1 from public.notifications n
      where n.employee_id = e.id and n.kind = 'registration_reminder' and n.created_at > now() - interval '12 hours'
    );
  get diagnostics v_count = row_count;

  if v_count > 0 then
    perform private.push_now();
  end if;
  return v_count;
end;
$$;
revoke all on function private.remind_unregistered_shifts() from public;

select cron.schedule('bomyden-registration-reminder', '0 8 * * 0', 'select private.remind_unregistered_shifts()');
