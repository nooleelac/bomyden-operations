-- =====================================================================
-- KHO: KIỂM KÊ + XUẤT KHO + MỨC TỒN TỐI THIỂU (10/10/2026)
-- =====================================================================
--   * Kiểm kê (khi cần): đếm tồn thực tế từng nguyên liệu → tồn kho đặt bằng số đếm.
--     Lượng đã dùng (tiêu hao) = tồn trên sổ − tồn đếm được (sổ = lần đếm trước + nhập − xuất).
--     Đếm một phần được (chỉ những món đã nhập số). Phiếu kiểm kê không hủy được — sai thì đếm lại.
--   * Phiếu xuất: hủy hàng (hư hỏng / hết hạn), chuyển chi nhánh, khác — bắt buộc lý do.
--     Chuyển chi nhánh: trừ tồn nơi đi, cộng tồn nơi đến. QTV / QL chi nhánh nơi đi được hủy phiếu.
--   * Quyền kiểm kê / xuất: QTV, QL chi nhánh, NV được bật "nhập kho" tại chi nhánh mình.
--   * Mức tồn tối thiểu theo chi nhánh (QTV / QL đặt). Dưới mức → hiện trên Tổng quan / Kho,
--     và 09:00 hằng ngày gửi thông báo cho QL chi nhánh + QTV.
--   * Giá vốn = giá nhập gần nhất SAU VAT (quy về 1 đơn vị kho), chụp lại lúc lập phiếu.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CỘT MỚI
-- ---------------------------------------------------------------------
alter table public.stock_balances add column min_quantity numeric(16, 4);
alter table public.stock_balances add constraint stock_balances_min_check check (min_quantity is null or min_quantity >= 0);

-- ---------------------------------------------------------------------
-- 2. KIỂM KÊ
-- ---------------------------------------------------------------------
create table public.stock_counts (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches (id),
  counted_on     date not null default private.vn_today(),
  note           text,
  line_count     integer not null default 0,
  -- giá trị hàng đã dùng / hao hụt (tồn sổ > tồn đếm) và dư (tồn đếm > tồn sổ), theo giá vốn
  used_value     numeric(16, 2) not null default 0,
  surplus_value  numeric(16, 2) not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.employees (id),
  constraint stock_counts_note_len check (note is null or char_length(note) <= 500)
);
create index stock_counts_branch_idx  on public.stock_counts (branch_id, created_at desc);
create index stock_counts_created_idx on public.stock_counts (created_by);

create table public.stock_count_lines (
  id           uuid primary key default gen_random_uuid(),
  count_id     uuid not null references public.stock_counts (id),
  item_id      uuid not null references public.inventory_items (id),
  system_qty   numeric(16, 4) not null,
  counted_qty  numeric(16, 4) not null,
  -- dương = đã dùng / hao hụt, âm = dư so với sổ
  used_qty     numeric(16, 4) generated always as (system_qty - counted_qty) stored,
  unit_cost    numeric(16, 4),
  constraint stock_count_lines_unique unique (count_id, item_id),
  constraint stock_count_lines_qty check (counted_qty >= 0)
);
create index stock_count_lines_item_idx on public.stock_count_lines (item_id);

-- ---------------------------------------------------------------------
-- 3. PHIẾU XUẤT
-- ---------------------------------------------------------------------
create type public.stock_issue_kind as enum ('waste', 'transfer', 'other');
create type public.stock_issue_status as enum ('posted', 'cancelled');

create table public.stock_issues (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches (id),
  kind          public.stock_issue_kind not null,
  to_branch_id  uuid references public.branches (id),
  issued_on     date not null default private.vn_today(),
  reason        text not null,
  status        public.stock_issue_status not null default 'posted',
  total_value   numeric(16, 2) not null default 0,
  cancelled_at  timestamptz,
  cancelled_by  uuid references public.employees (id),
  cancel_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.employees (id),
  constraint stock_issues_reason_len check (char_length(btrim(reason)) between 3 and 500),
  constraint stock_issues_transfer check ((kind = 'transfer') = (to_branch_id is not null) and to_branch_id is distinct from branch_id)
);
create index stock_issues_branch_idx    on public.stock_issues (branch_id, created_at desc);
create index stock_issues_to_branch_idx on public.stock_issues (to_branch_id);
create index stock_issues_created_idx   on public.stock_issues (created_by);
create index stock_issues_cancelled_idx on public.stock_issues (cancelled_by);

create table public.stock_issue_lines (
  id            uuid primary key default gen_random_uuid(),
  issue_id      uuid not null references public.stock_issues (id),
  line_no       smallint not null,
  item_id       uuid not null references public.inventory_items (id),
  quantity      numeric(16, 4) not null,
  unit_name     text not null,
  factor        numeric(14, 4) not null,
  base_quantity numeric(16, 4) not null,
  unit_cost     numeric(16, 4),
  amount        numeric(16, 2) not null default 0,
  constraint stock_issue_lines_qty check (quantity > 0 and base_quantity > 0 and factor > 0)
);
create index stock_issue_lines_issue_idx on public.stock_issue_lines (issue_id, line_no);
create index stock_issue_lines_item_idx  on public.stock_issue_lines (item_id);

-- Liên kết sổ phát sinh
alter table public.stock_movements add column count_id uuid references public.stock_counts (id);
alter table public.stock_movements add column issue_id uuid references public.stock_issues (id);
create index stock_movements_count_idx on public.stock_movements (count_id);
create index stock_movements_issue_idx on public.stock_movements (issue_id);

-- ---------------------------------------------------------------------
-- 4. BẢO VỆ + RLS
-- ---------------------------------------------------------------------
create trigger stock_counts_forbid_delete before delete on public.stock_counts
for each row execute function private.forbid_delete();
create trigger stock_count_lines_forbid_delete before delete on public.stock_count_lines
for each row execute function private.forbid_delete();
create trigger stock_issues_forbid_delete before delete on public.stock_issues
for each row execute function private.forbid_delete();
create trigger stock_issue_lines_forbid_delete before delete on public.stock_issue_lines
for each row execute function private.forbid_delete();
create trigger stock_counts_audit after insert on public.stock_counts
for each row execute function private.write_audit_log();
create trigger stock_issues_audit after insert or update on public.stock_issues
for each row execute function private.write_audit_log();

alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
alter table public.stock_issues enable row level security;
alter table public.stock_issue_lines enable row level security;

revoke all on public.stock_counts, public.stock_count_lines, public.stock_issues, public.stock_issue_lines from anon;
revoke insert, update, delete, truncate on public.stock_counts, public.stock_count_lines, public.stock_issues, public.stock_issue_lines
  from authenticated;

create policy "stock_counts_select" on public.stock_counts for select to authenticated
using ((select private.inventory_branch_access(branch_id)));
create policy "stock_count_lines_select" on public.stock_count_lines for select to authenticated
using (exists (
  select 1 from public.stock_counts c
  where c.id = count_id and (select private.inventory_branch_access(c.branch_id))
));
-- Phiếu chuyển: chi nhánh nơi đến cũng xem được
create policy "stock_issues_select" on public.stock_issues for select to authenticated
using (
  (select private.inventory_branch_access(branch_id))
  or (to_branch_id is not null and (select private.inventory_branch_access(to_branch_id)))
);
create policy "stock_issue_lines_select" on public.stock_issue_lines for select to authenticated
using (exists (
  select 1 from public.stock_issues i
  where i.id = issue_id
    and ((select private.inventory_branch_access(i.branch_id))
         or (i.to_branch_id is not null and (select private.inventory_branch_access(i.to_branch_id))))
));

-- ---------------------------------------------------------------------
-- 5. HÀM NỘI BỘ
-- ---------------------------------------------------------------------
-- Giá vốn hiện tại: giá nhập gần nhất SAU VAT / 1 đơn vị kho (khớp loadLastPrices phía app)
create or replace function private.item_unit_cost(p_item_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select round((l.amount + l.vat_amount) / l.base_quantity, 4)
  from public.stock_receipt_lines l
  join public.stock_receipts r on r.id = l.receipt_id and r.status = 'posted'
  where l.item_id = p_item_id and l.base_quantity > 0 and l.amount + l.vat_amount > 0
  order by r.invoice_date desc, r.created_at desc, l.line_no
  limit 1
$$;
revoke all on function private.item_unit_cost(uuid) from public;

-- Ghi 1 phát sinh (kiểm kê / xuất) + cập nhật tồn
create or replace function private.apply_stock_move(
  p_branch_id uuid, p_item_id uuid, p_kind public.stock_movement_kind, p_change numeric,
  p_count_id uuid, p_issue_id uuid, p_reason text
)
returns numeric
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_balance numeric;
begin
  insert into public.stock_balances as b (branch_id, item_id, quantity, updated_at)
  values (p_branch_id, p_item_id, p_change, now())
  on conflict (branch_id, item_id) do update
    set quantity = b.quantity + excluded.quantity, updated_at = now()
  returning quantity into v_balance;

  insert into public.stock_movements (branch_id, item_id, kind, change, balance_after, count_id, issue_id, reason, created_by)
  values (p_branch_id, p_item_id, p_kind, p_change, v_balance, p_count_id, p_issue_id, p_reason, private.current_employee_id());
  return v_balance;
end;
$$;
revoke all on function private.apply_stock_move(uuid, uuid, public.stock_movement_kind, numeric, uuid, uuid, text) from public;

-- ---------------------------------------------------------------------
-- 6. RPC: LƯU PHIẾU KIỂM KÊ
-- ---------------------------------------------------------------------
-- p_lines: [{"item_id": uuid, "counted_qty": number (đơn vị kho)}]
create or replace function public.create_stock_count(p_branch_id uuid, p_note text, p_lines jsonb)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count   uuid;
  v_line    jsonb;
  v_item    uuid;
  v_qty     numeric;
  v_system  numeric;
  v_cost    numeric;
  v_n       integer := 0;
  v_used    numeric := 0;
  v_surplus numeric := 0;
begin
  if not public.can_receive_stock_at(p_branch_id) then
    raise exception 'Bạn không có quyền kiểm kê kho chi nhánh này.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Chưa nhập số đếm cho nguyên liệu nào.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 1000 then
    raise exception 'Phiếu kiểm kê quá dài.' using errcode = 'P0001';
  end if;

  insert into public.stock_counts (branch_id, note, created_by)
  values (p_branch_id, nullif(left(btrim(coalesce(p_note, '')), 500), ''), private.current_employee_id())
  returning id into v_count;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_item := nullif(v_line ->> 'item_id', '')::uuid;
    v_qty := round(nullif(v_line ->> 'counted_qty', '')::numeric, 4);
    if v_item is null or not exists (select 1 from public.inventory_items i where i.id = v_item) then
      raise exception 'Dòng %: không tìm thấy nguyên liệu.', v_n using errcode = 'P0001';
    end if;
    if v_qty is null or v_qty < 0 then
      raise exception 'Dòng %: số đếm phải từ 0 trở lên.', v_n using errcode = 'P0001';
    end if;
    if exists (select 1 from public.stock_count_lines l where l.count_id = v_count and l.item_id = v_item) then
      raise exception 'Dòng %: nguyên liệu bị lặp.', v_n using errcode = 'P0001';
    end if;

    select b.quantity into v_system from public.stock_balances b
    where b.branch_id = p_branch_id and b.item_id = v_item for update;
    v_system := coalesce(v_system, 0);
    v_cost := private.item_unit_cost(v_item);

    insert into public.stock_count_lines (count_id, item_id, system_qty, counted_qty, unit_cost)
    values (v_count, v_item, v_system, v_qty, v_cost);

    if v_qty <> v_system then
      perform private.apply_stock_move(p_branch_id, v_item, 'count', v_qty - v_system, v_count, null, 'Kiểm kê');
    end if;
    if v_system > v_qty then
      v_used := v_used + (v_system - v_qty) * coalesce(v_cost, 0);
    else
      v_surplus := v_surplus + (v_qty - v_system) * coalesce(v_cost, 0);
    end if;
  end loop;

  update public.stock_counts c
  set line_count = v_n, used_value = round(v_used, 2), surplus_value = round(v_surplus, 2)
  where c.id = v_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. RPC: LƯU PHIẾU XUẤT
-- ---------------------------------------------------------------------
-- p_payload: {"branch_id", "kind": waste|transfer|other, "to_branch_id"?, "reason",
--             "lines": [{"item_id", "quantity", "unit_name"}]}  — đơn vị phụ lấy hệ số từ danh mục
create or replace function public.create_stock_issue(p_payload jsonb)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_branch  uuid := nullif(p_payload ->> 'branch_id', '')::uuid;
  v_kind    public.stock_issue_kind := (p_payload ->> 'kind')::public.stock_issue_kind;
  v_to      uuid := nullif(p_payload ->> 'to_branch_id', '')::uuid;
  v_reason  text := btrim(coalesce(p_payload ->> 'reason', ''));
  v_issue   uuid;
  v_line    jsonb;
  v_no      smallint := 0;
  v_item    uuid;
  v_base    text;
  v_unit    text;
  v_factor  numeric;
  v_qty     numeric;
  v_bqty    numeric;
  v_cost    numeric;
  v_amount  numeric;
  v_total   numeric := 0;
  v_label   text;
begin
  if v_branch is null or not public.can_receive_stock_at(v_branch) then
    raise exception 'Bạn không có quyền xuất kho chi nhánh này.' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'Vui lòng ghi lý do xuất kho.' using errcode = 'P0001';
  end if;
  if v_kind = 'transfer' then
    if v_to is null or v_to = v_branch or not exists (select 1 from public.branches b where b.id = v_to and b.is_active) then
      raise exception 'Chọn chi nhánh nhận hàng (khác chi nhánh xuất).' using errcode = 'P0001';
    end if;
  else
    v_to := null;
  end if;
  if jsonb_typeof(p_payload -> 'lines') <> 'array' or jsonb_array_length(p_payload -> 'lines') = 0 then
    raise exception 'Phiếu xuất chưa có nguyên liệu nào.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_payload -> 'lines') > 200 then
    raise exception 'Phiếu xuất quá dài.' using errcode = 'P0001';
  end if;

  insert into public.stock_issues (branch_id, kind, to_branch_id, reason, created_by)
  values (v_branch, v_kind, v_to, left(v_reason, 500), private.current_employee_id())
  returning id into v_issue;

  v_label := case v_kind when 'waste' then 'Hủy hàng' when 'transfer' then 'Chuyển chi nhánh' else 'Xuất khác' end
             || ': ' || left(v_reason, 200);

  for v_line in select * from jsonb_array_elements(p_payload -> 'lines') loop
    v_no := v_no + 1;
    v_item := nullif(v_line ->> 'item_id', '')::uuid;
    v_qty := round(nullif(v_line ->> 'quantity', '')::numeric, 4);
    v_unit := btrim(coalesce(v_line ->> 'unit_name', ''));

    select i.base_unit into v_base from public.inventory_items i where i.id = v_item;
    if v_base is null then
      raise exception 'Dòng %: không tìm thấy nguyên liệu.', v_no using errcode = 'P0001';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Dòng %: số lượng phải lớn hơn 0.', v_no using errcode = 'P0001';
    end if;
    if v_unit = '' or private.norm_name(v_unit) = private.norm_name(v_base) then
      v_unit := v_base;
      v_factor := 1;
    else
      v_factor := null;
      select u.factor, u.unit_name into v_factor, v_base from public.inventory_item_units u
      where u.item_id = v_item and private.norm_name(u.unit_name) = private.norm_name(v_unit);
      if v_factor is null then
        raise exception 'Dòng %: đơn vị "%" chưa có quy đổi.', v_no, v_unit using errcode = 'P0001';
      end if;
      v_unit := v_base;
    end if;

    v_bqty := round(v_qty * v_factor, 4);
    v_cost := private.item_unit_cost(v_item);
    v_amount := round(v_bqty * coalesce(v_cost, 0), 2);
    v_total := v_total + v_amount;

    insert into public.stock_issue_lines (issue_id, line_no, item_id, quantity, unit_name, factor, base_quantity, unit_cost, amount)
    values (v_issue, v_no, v_item, v_qty, v_unit, v_factor, v_bqty, v_cost, v_amount);

    perform private.apply_stock_move(v_branch, v_item, 'issue', -v_bqty, null, v_issue, v_label);
    if v_to is not null then
      perform private.apply_stock_move(v_to, v_item, 'transfer_in', v_bqty, null, v_issue, v_label);
    end if;
  end loop;

  update public.stock_issues i set total_value = v_total where i.id = v_issue;
  return v_issue;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. RPC: HỦY PHIẾU XUẤT (QTV / QL chi nhánh xuất)
-- ---------------------------------------------------------------------
create or replace function public.cancel_stock_issue(p_issue_id uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_issue public.stock_issues;
  v_line  public.stock_issue_lines;
  v_note  text := left(btrim(coalesce(p_reason, '')), 500);
begin
  select * into v_issue from public.stock_issues i where i.id = p_issue_id for update;
  if v_issue.id is null or not private.manages_branch(v_issue.branch_id) then
    raise exception 'Không tìm thấy phiếu xuất hoặc bạn không có quyền hủy.' using errcode = '42501';
  end if;
  if v_issue.status <> 'posted' then
    raise exception 'Phiếu xuất này đã bị hủy trước đó.' using errcode = 'P0001';
  end if;
  if char_length(v_note) < 3 then
    raise exception 'Vui lòng nhập lý do hủy phiếu.' using errcode = 'P0001';
  end if;

  update public.stock_issues i set
    status = 'cancelled', cancelled_at = now(), cancelled_by = private.current_employee_id(), cancel_reason = v_note
  where i.id = v_issue.id;

  for v_line in select * from public.stock_issue_lines l where l.issue_id = v_issue.id order by l.line_no loop
    perform private.apply_stock_move(v_issue.branch_id, v_line.item_id, 'issue_cancel', v_line.base_quantity, null, v_issue.id, 'Hủy phiếu xuất: ' || v_note);
    if v_issue.to_branch_id is not null then
      perform private.apply_stock_move(v_issue.to_branch_id, v_line.item_id, 'transfer_in_cancel', -v_line.base_quantity, null, v_issue.id, 'Hủy phiếu xuất: ' || v_note);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. RPC: ĐẶT MỨC TỒN TỐI THIỂU (QTV / QL chi nhánh) — null = bỏ cảnh báo
-- ---------------------------------------------------------------------
create or replace function public.set_stock_min(p_branch_id uuid, p_item_id uuid, p_min numeric)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if not private.manages_branch(p_branch_id) then
    raise exception 'Bạn không có quyền đặt mức tồn tối thiểu cho chi nhánh này.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.inventory_items i where i.id = p_item_id) then
    raise exception 'Không tìm thấy nguyên liệu.' using errcode = 'P0001';
  end if;
  if p_min is not null and p_min < 0 then
    raise exception 'Mức tối thiểu phải từ 0 trở lên.' using errcode = 'P0001';
  end if;

  insert into public.stock_balances as b (branch_id, item_id, quantity, min_quantity)
  values (p_branch_id, p_item_id, 0, round(p_min, 4))
  on conflict (branch_id, item_id) do update set min_quantity = excluded.min_quantity;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. THÔNG BÁO TỒN THẤP — 09:00 giờ VN hằng ngày, 1 thông báo / chi nhánh / người nhận
-- ---------------------------------------------------------------------
create or replace function private.notify_low_stock()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_branch record;
  v_count  integer := 0;
  v_n      integer;
begin
  for v_branch in
    select br.id, br.name, count(*) as items,
           string_agg(i.name || ' ' || trim(to_char(b.quantity, 'FM999999990.###')) || '/'
                      || trim(to_char(b.min_quantity, 'FM999999990.###')) || ' ' || i.base_unit,
                      ', ' order by b.quantity / nullif(b.min_quantity, 0) nulls first, i.name) as list
    from public.stock_balances b
    join public.inventory_items i on i.id = b.item_id and i.is_active
    join public.branches br on br.id = b.branch_id and br.is_active
    where b.min_quantity is not null and b.quantity < b.min_quantity
    group by br.id, br.name
  loop
    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    select r.employee_id, 'low_stock', v_branch.id,
           '⚠️ ' || v_branch.items || ' nguyên liệu dưới mức tối thiểu — ' || v_branch.name,
           left(v_branch.list, 300),
           '/inventory?branch=' || v_branch.id || '&low=1'
    from private.schedule_reviewers(v_branch.id, null, '{}'::uuid[]) r
    where not exists (
      select 1 from public.notifications n
      where n.employee_id = r.employee_id and n.kind = 'low_stock' and n.ref_id = v_branch.id
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
revoke all on function private.notify_low_stock() from public;

select cron.schedule('bomyden-low-stock', '0 2 * * *', 'select private.notify_low_stock()');

-- ---------------------------------------------------------------------
-- 11. QUYỀN GỌI HÀM
-- ---------------------------------------------------------------------
revoke all on function public.create_stock_count(uuid, text, jsonb) from public, anon;
revoke all on function public.create_stock_issue(jsonb) from public, anon;
revoke all on function public.cancel_stock_issue(uuid, text) from public, anon;
revoke all on function public.set_stock_min(uuid, uuid, numeric) from public, anon;
grant execute on function public.create_stock_count(uuid, text, jsonb) to authenticated;
grant execute on function public.create_stock_issue(jsonb) to authenticated;
grant execute on function public.cancel_stock_issue(uuid, text) to authenticated;
grant execute on function public.set_stock_min(uuid, uuid, numeric) to authenticated;
