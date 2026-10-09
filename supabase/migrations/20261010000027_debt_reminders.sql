-- =====================================================================
-- NHẮC CÔNG NỢ NHÀ CUNG CẤP (10/10/2026)
-- =====================================================================
--   * 09:00 giờ VN hằng ngày, gửi QL chi nhánh + QTV (người được ghi thanh toán).
--   * Sắp đến hạn: còn đúng 3 ngày, và đúng ngày đến hạn.
--   * Quá hạn mà còn nợ: nhắc mỗi ngày đến khi trả xong.
--   * Gộp 1 thông báo / chi nhánh / người nhận, liệt kê theo nhà cung cấp (quá hạn lâu nhất trước).
-- =====================================================================

create or replace function private.vn_money(p_amount numeric)
returns text
language sql immutable
set search_path = ''
as $$
  select replace(to_char(round(p_amount), 'FM999,999,999,990'), ',', '.') || 'đ'
$$;
revoke all on function private.vn_money(numeric) from public;

create or replace function private.notify_supplier_debts()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_today  date := private.vn_today();
  v_branch record;
  v_count  integer := 0;
  v_n      integer;
  v_title  text;
begin
  for v_branch in
    with due as (
      select r.branch_id, coalesce(s.name, 'Không rõ NCC') as supplier,
             sum(r.debt_amount) as debt, min(r.due_date) as due_date,
             bool_or(r.due_date < v_today) as overdue
      from public.stock_receipts r
      left join public.suppliers s on s.id = r.supplier_id
      where r.status = 'posted' and r.debt_amount > 0 and r.due_date is not null
        and (r.due_date < v_today or r.due_date = v_today or r.due_date = v_today + 3)
      group by r.branch_id, coalesce(s.name, 'Không rõ NCC'), (r.due_date < v_today), r.due_date
    )
    select br.id, br.name,
           count(*) filter (where d.overdue) as overdue_n,
           count(*) filter (where not d.overdue) as soon_n,
           sum(d.debt) filter (where d.overdue) as overdue_sum,
           string_agg(
             d.supplier || ' ' || private.vn_money(d.debt) || ' ('
               || case when d.overdue then 'quá hạn ' || (v_today - d.due_date) || ' ngày'
                       when d.due_date = v_today then 'đến hạn hôm nay'
                       else 'đến hạn ' || to_char(d.due_date, 'DD/MM') end || ')',
             '; ' order by d.due_date, d.debt desc) as list
    from due d
    join public.branches br on br.id = d.branch_id and br.is_active
    group by br.id, br.name
  loop
    v_title := '💸 Công nợ NCC — ' || v_branch.name || ': '
      || case when v_branch.overdue_n > 0 then 'quá hạn ' || private.vn_money(v_branch.overdue_sum) else '' end
      || case when v_branch.overdue_n > 0 and v_branch.soon_n > 0 then ', ' else '' end
      || case when v_branch.soon_n > 0 then v_branch.soon_n || ' khoản sắp đến hạn' else '' end;

    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    select r.employee_id, 'debt_due', v_branch.id, left(v_title, 200), left(v_branch.list, 400), '/inventory/debts'
    from private.schedule_reviewers(v_branch.id, null, '{}'::uuid[]) r
    where not exists (
      select 1 from public.notifications n
      where n.employee_id = r.employee_id and n.kind = 'debt_due' and n.ref_id = v_branch.id
        and n.created_at > now() - interval '20 hours'
    );
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;

  if v_count > 0 then
    perform private.push_now();
  end if;
  return v_count;
end;
$$;
revoke all on function private.notify_supplier_debts() from public;

select cron.schedule('bomyden-debt-reminder', '0 2 * * *', 'select private.notify_supplier_debts()');
