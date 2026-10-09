-- Định dạng tiền kiểu Việt Nam (1.000.000) trong thông báo lỗi & thông báo đẩy ứng lương
create or replace function private.format_vnd(p_amount bigint)
returns text
language sql immutable
set search_path = ''
as $$
  select replace(to_char(p_amount, 'FM999,999,999,990'), ',', '.') || 'đ'
$$;
revoke all on function private.format_vnd(bigint) from public;

create or replace function public.request_salary_advance(p_amount bigint, p_reason text default null)
returns public.salary_advances
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_employee_id();
  v_quota  jsonb;
  v_result public.salary_advances;
begin
  if v_me is null then
    raise exception 'Bạn chưa đăng nhập.' using errcode = '42501';
  end if;
  -- Chặn gửi trùng song song
  perform pg_advisory_xact_lock(hashtext('salary_advance:' || v_me::text));

  v_quota := private.advance_quota(v_me);
  if v_quota is null then
    raise exception 'Bạn chưa có hồ sơ lương nên chưa ứng lương được.' using errcode = 'P0001';
  end if;
  if (v_quota ->> 'closed')::boolean then
    raise exception 'Kỳ lương hiện tại của bạn đã chốt.' using errcode = 'P0001';
  end if;
  if (v_quota ->> 'percent')::integer = 0 then
    raise exception 'Quán đang tắt chức năng ứng lương.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount < 1000 then
    raise exception 'Số tiền ứng tối thiểu 1.000đ.' using errcode = 'P0001';
  end if;
  if p_amount > (v_quota ->> 'available')::bigint then
    raise exception 'Bạn chỉ có thể ứng tối đa % trong kỳ này.',
      private.format_vnd((v_quota ->> 'available')::bigint) using errcode = 'P0001';
  end if;

  insert into public.salary_advances (employee_id, period_start, amount, reason)
  values (v_me, (v_quota ->> 'period_start')::date, p_amount, nullif(btrim(coalesce(p_reason, '')), ''))
  returning * into v_result;
  return v_result;
end;
$$;

create or replace function private.salary_advances_notify()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_money text := private.format_vnd(new.amount);
  v_n     integer := 0;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    select full_name into v_name from public.employees where id = new.employee_id;
    -- QTV + QL có quyền lương cùng chi nhánh (QL không duyệt cho QTV / Quản lý khác)
    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    select m.id, 'advance_new', new.id, '💵 Đơn ứng lương: ' || v_name,
           v_money || coalesce(' · Lý do: ' || left(new.reason, 80), ''), '/payroll/advances'
    from public.employees m
    where m.is_active and m.id <> new.employee_id
      and (
        m.role = 'admin'
        or (m.role = 'manager' and m.can_manage_payroll
            and exists (select 1 from public.employees x where x.id = new.employee_id and x.role not in ('admin', 'manager'))
            and exists (
              select 1 from public.employee_branches mb
              join public.employee_branches xb on xb.branch_id = mb.branch_id
              where mb.employee_id = m.id and xb.employee_id = new.employee_id
            ))
      );
    get diagnostics v_n = row_count;
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    values (new.employee_id, 'advance_result', new.id,
            case when new.status = 'approved' then '✅ Đơn ứng lương đã được duyệt' else '❌ Đơn ứng lương bị từ chối' end,
            v_money || case when new.status = 'approved' then ' — sẽ trừ vào lương kỳ này' else '' end
              || coalesce(' · ' || new.review_note, ''),
            '/payslips');
    v_n := 1;
  end if;

  if v_n > 0 then
    perform private.push_now();
  end if;
  return null;
end;
$$;
