-- =====================================================================
-- PHASE 6.1 — VAT THEO TỪNG DÒNG + CÔNG NỢ NHÀ CUNG CẤP
-- =====================================================================
-- Nghiệp vụ đã chốt (09/10/2026):
--   * Mỗi dòng có thuế suất VAT riêng (0/5/8/10%…). Thành tiền dòng = trước VAT; tiền thuế dòng = thành tiền × thuế suất.
--   * Giá vốn (lịch sử giá, cảnh báo giá, giá trị tồn) tính SAU VAT.
--   * Phiếu: tiền hàng (subtotal) + tiền thuế (vat_amount) = tổng thanh toán (total_amount).
--   * Công nợ: lúc lưu phiếu chọn đã trả đủ / trả một phần / chưa trả (+ hình thức, hạn thanh toán).
--     Còn nợ thì bắt buộc có nhà cung cấp. Hạn mặc định = ngày hóa đơn + số ngày nợ của NCC.
--   * Thanh toán sau đó (trả nhiều lần) do QTV / QL chi nhánh ghi. Không xóa, chỉ hủy kèm lý do.
--   * Hủy phiếu nhập → tự hủy các lần thanh toán của phiếu.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CỘT MỚI
-- ---------------------------------------------------------------------
alter table public.stock_receipt_lines
  add column vat_rate   numeric(5, 2)  not null default 0,
  add column vat_amount numeric(16, 2) not null default 0,
  add constraint stock_receipt_lines_vat check (vat_rate >= 0 and vat_rate <= 100 and vat_amount >= 0);

alter table public.suppliers
  add column payment_terms_days smallint,
  add constraint suppliers_terms check (payment_terms_days is null or payment_terms_days between 0 and 365);

alter table public.stock_receipts
  add column subtotal    numeric(16, 2) not null default 0,
  add column vat_amount  numeric(16, 2) not null default 0,
  add column paid_amount numeric(16, 2) not null default 0,
  add column due_date    date,
  add constraint stock_receipts_money check (subtotal >= 0 and vat_amount >= 0 and paid_amount >= 0);

alter table public.stock_receipts
  add column debt_amount numeric(16, 2) generated always as (
    case when status = 'posted' then greatest(total_amount - paid_amount, 0) else 0 end
  ) stored;

comment on column public.stock_receipts.total_amount is 'Tổng thanh toán SAU VAT = subtotal + vat_amount';
comment on column public.stock_receipt_lines.amount is 'Thành tiền TRƯỚC VAT';

create index stock_receipts_debt_idx on public.stock_receipts (supplier_id, due_date) where debt_amount > 0;

-- ---------------------------------------------------------------------
-- 2. THANH TOÁN CHO NHÀ CUNG CẤP
-- ---------------------------------------------------------------------
create type public.payment_method as enum ('cash', 'transfer', 'other');

create table public.supplier_payments (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.stock_receipts (id),
  branch_id   uuid not null references public.branches (id),
  supplier_id uuid references public.suppliers (id),
  amount      numeric(16, 2) not null,
  paid_on     date not null,
  method      public.payment_method not null default 'cash',
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid not null references public.employees (id),
  voided_at   timestamptz,
  voided_by   uuid references public.employees (id),
  void_reason text,

  constraint supplier_payments_amount check (amount > 0),
  constraint supplier_payments_note   check (note is null or char_length(note) <= 300),
  constraint supplier_payments_void   check ((voided_at is null) = (voided_by is null))
);
create index supplier_payments_receipt_idx  on public.supplier_payments (receipt_id);
create index supplier_payments_branch_idx   on public.supplier_payments (branch_id, paid_on desc);
create index supplier_payments_supplier_idx on public.supplier_payments (supplier_id);
create index supplier_payments_created_idx  on public.supplier_payments (created_by);
create index supplier_payments_voided_idx   on public.supplier_payments (voided_by);

create trigger supplier_payments_forbid_delete before delete on public.supplier_payments
for each row execute function private.forbid_delete();
create trigger supplier_payments_audit after insert or update on public.supplier_payments
for each row execute function private.write_audit_log();

-- Tính lại số đã trả của phiếu từ các lần thanh toán còn hiệu lực
create or replace function private.refresh_receipt_paid(p_receipt_id uuid)
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.stock_receipts r
  set paid_amount = coalesce((
    select sum(p.amount) from public.supplier_payments p
    where p.receipt_id = r.id and p.voided_at is null
  ), 0)
  where r.id = p_receipt_id;
$$;
revoke all on function private.refresh_receipt_paid(uuid) from public;

-- ---------------------------------------------------------------------
-- 3. LƯU PHIẾU NHẬP (thay bản cũ): thêm VAT từng dòng + thanh toán
-- ---------------------------------------------------------------------
-- p_payload thêm:
--   lines[].vat_rate: number (0..100)
--   "payment": { "paid_amount": number, "method": "cash"|"transfer"|"other", "due_date": "YYYY-MM-DD"|null }
create or replace function public.create_stock_receipt(p_payload jsonb)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me          uuid := private.current_employee_id();
  v_branch      uuid := (p_payload ->> 'branch_id')::uuid;
  v_scan_id     uuid := nullif(p_payload ->> 'scan_id', '')::uuid;
  v_supplier    uuid := nullif(p_payload ->> 'supplier_id', '')::uuid;
  v_new_sup     text := nullif(regexp_replace(btrim(coalesce(p_payload ->> 'new_supplier_name', '')), '\s+', ' ', 'g'), '');
  v_invoice_no  text := nullif(btrim(coalesce(p_payload ->> 'invoice_number', '')), '');
  v_date        date := (p_payload ->> 'invoice_date')::date;
  v_inv_total   numeric := nullif(p_payload ->> 'invoice_total', '')::numeric;
  v_note        text := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  v_paid        numeric := coalesce(nullif(p_payload -> 'payment' ->> 'paid_amount', '')::numeric, 0);
  v_method      public.payment_method := coalesce(nullif(p_payload -> 'payment' ->> 'method', ''), 'cash')::public.payment_method;
  v_due         date := nullif(p_payload -> 'payment' ->> 'due_date', '')::date;
  v_terms       smallint;
  v_scan        public.invoice_scans;
  v_receipt     uuid;
  v_line        jsonb;
  v_no          smallint := 0;
  v_item        uuid;
  v_base_unit   text;
  v_unit        text;
  v_factor      numeric;
  v_qty         numeric;
  v_price       numeric;
  v_amount      numeric;
  v_rate        numeric;
  v_vat         numeric;
  v_raw         text;
  v_subtotal    numeric := 0;
  v_vat_total   numeric := 0;
  v_total       numeric;
  v_dup_date    date;
begin
  if v_me is null then
    raise exception 'Tài khoản không hợp lệ.' using errcode = '42501';
  end if;
  if v_branch is null or not public.can_receive_stock_at(v_branch) then
    raise exception 'Bạn không có quyền nhập kho cho chi nhánh này.' using errcode = '42501';
  end if;
  if v_date is null or v_date > private.vn_today() + 1 or v_date < private.vn_today() - 365 then
    raise exception 'Ngày hóa đơn không hợp lệ.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_payload -> 'lines') <> 'array'
     or jsonb_array_length(p_payload -> 'lines') = 0
     or jsonb_array_length(p_payload -> 'lines') > 100 then
    raise exception 'Phiếu nhập phải có từ 1 đến 100 dòng hàng.' using errcode = 'P0001';
  end if;
  if v_paid < 0 then
    raise exception 'Số tiền đã trả không hợp lệ.' using errcode = 'P0001';
  end if;

  if v_scan_id is not null then
    select * into v_scan from public.invoice_scans s where s.id = v_scan_id for update;
    if v_scan.id is null or v_scan.employee_id <> v_me or v_scan.branch_id <> v_branch then
      raise exception 'Ảnh hóa đơn không hợp lệ.' using errcode = 'P0001';
    end if;
    if v_scan.receipt_id is not null then
      raise exception 'Ảnh hóa đơn này đã được lưu thành phiếu nhập.' using errcode = 'P0001';
    end if;
  end if;

  if v_supplier is null and v_new_sup is not null then
    select s.id into v_supplier from public.suppliers s where private.norm_name(s.name) = private.norm_name(v_new_sup);
    if v_supplier is null then
      insert into public.suppliers (name) values (left(v_new_sup, 150)) returning id into v_supplier;
    end if;
  elsif v_supplier is not null and not exists (select 1 from public.suppliers s where s.id = v_supplier) then
    raise exception 'Không tìm thấy nhà cung cấp.' using errcode = 'P0001';
  end if;

  if v_supplier is not null and v_invoice_no is not null then
    select r.invoice_date into v_dup_date from public.stock_receipts r
    where r.supplier_id = v_supplier and private.norm_name(r.invoice_number) = private.norm_name(v_invoice_no)
      and r.status = 'posted'
    limit 1;
    if v_dup_date is not null then
      raise exception 'Hóa đơn số % của nhà cung cấp này đã được nhập kho (ngày %).',
        v_invoice_no, to_char(v_dup_date, 'DD/MM/YYYY') using errcode = 'P0001';
    end if;
  end if;

  insert into public.stock_receipts (
    branch_id, supplier_id, invoice_number, invoice_date, invoice_total, total_amount, note,
    scan_id, photo_path, created_by
  ) values (
    v_branch, v_supplier, left(v_invoice_no, 50), v_date, v_inv_total, 0, left(v_note, 500),
    v_scan.id, v_scan.photo_path, v_me
  ) returning id into v_receipt;

  for v_line in select * from jsonb_array_elements(p_payload -> 'lines') loop
    v_no     := v_no + 1;
    v_item   := nullif(v_line ->> 'item_id', '')::uuid;
    v_qty    := (v_line ->> 'quantity')::numeric;
    v_factor := (v_line ->> 'factor')::numeric;
    v_price  := coalesce(nullif(v_line ->> 'unit_price', '')::numeric, 0);
    v_amount := coalesce(nullif(v_line ->> 'amount', '')::numeric, 0);
    v_rate   := coalesce(nullif(v_line ->> 'vat_rate', '')::numeric, 0);
    v_unit   := regexp_replace(btrim(coalesce(v_line ->> 'unit_name', '')), '\s+', ' ', 'g');
    v_raw    := nullif(regexp_replace(btrim(coalesce(v_line ->> 'raw_name', '')), '\s+', ' ', 'g'), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'Dòng %: số lượng phải lớn hơn 0.', v_no using errcode = 'P0001';
    end if;
    if v_price < 0 or v_amount < 0 then
      raise exception 'Dòng %: đơn giá / thành tiền không hợp lệ.', v_no using errcode = 'P0001';
    end if;
    if v_rate < 0 or v_rate > 100 then
      raise exception 'Dòng %: thuế suất VAT không hợp lệ.', v_no using errcode = 'P0001';
    end if;
    v_vat := round(v_amount * v_rate / 100, 0);

    if v_item is null then
      if v_line -> 'new_item' is null or jsonb_typeof(v_line -> 'new_item') <> 'object'
         or btrim(coalesce(v_line -> 'new_item' ->> 'name', '')) = '' then
        raise exception 'Dòng %: chưa chọn nguyên liệu.', v_no using errcode = 'P0001';
      end if;
      select i.id into v_item from public.inventory_items i
      where private.norm_name(i.name) = private.norm_name(v_line -> 'new_item' ->> 'name');
      if v_item is null then
        if btrim(coalesce(v_line -> 'new_item' ->> 'base_unit', '')) = '' then
          raise exception 'Dòng %: chưa nhập đơn vị kho cho nguyên liệu mới.', v_no using errcode = 'P0001';
        end if;
        insert into public.inventory_items (name, category, base_unit)
        values (
          left(v_line -> 'new_item' ->> 'name', 150),
          coalesce(nullif(btrim(v_line -> 'new_item' ->> 'category'), ''), 'Khác'),
          left(btrim(v_line -> 'new_item' ->> 'base_unit'), 20)
        ) returning id into v_item;
      end if;
    end if;

    select i.base_unit into v_base_unit from public.inventory_items i where i.id = v_item and i.is_active;
    if v_base_unit is null then
      raise exception 'Dòng %: nguyên liệu không tồn tại hoặc đã ngừng dùng.', v_no using errcode = 'P0001';
    end if;

    if v_unit = '' or private.norm_name(v_unit) = private.norm_name(v_base_unit) then
      v_unit := v_base_unit;
      v_factor := 1;
    else
      if v_factor is null or v_factor <= 0 then
        raise exception 'Dòng %: chưa nhập quy đổi 1 % = ? %.', v_no, v_unit, v_base_unit using errcode = 'P0001';
      end if;
      insert into public.inventory_item_units as u (item_id, unit_name, factor)
      values (v_item, left(v_unit, 20), v_factor)
      on conflict (item_id, private.norm_name(unit_name)) do update
        set factor = excluded.factor
        where u.factor <> excluded.factor;
    end if;

    insert into public.stock_receipt_lines (
      receipt_id, line_no, item_id, raw_name, quantity, unit_name, factor, base_quantity, unit_price, amount, vat_rate, vat_amount
    ) values (
      v_receipt, v_no, v_item, left(v_raw, 200), v_qty, left(v_unit, 20), v_factor,
      round(v_qty * v_factor, 4), v_price, v_amount, v_rate, v_vat
    );
    v_subtotal  := v_subtotal + v_amount;
    v_vat_total := v_vat_total + v_vat;

    if v_raw is not null then
      insert into public.inventory_aliases as a (supplier_id, alias_norm, item_id, unit_name, factor)
      values (v_supplier, left(private.norm_name(v_raw), 200), v_item, left(v_unit, 20), v_factor)
      on conflict (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), alias_norm) do update
        set item_id = excluded.item_id, unit_name = excluded.unit_name, factor = excluded.factor, updated_at = now();
    end if;

    perform private.apply_stock_change(v_branch, v_item, 'receipt', round(v_qty * v_factor, 4), v_receipt, null);
  end loop;

  v_total := v_subtotal + v_vat_total;

  -- Thanh toán lúc nhận hàng
  if v_paid > v_total + 0.5 then
    raise exception 'Số tiền đã trả lớn hơn tổng thanh toán của phiếu.' using errcode = 'P0001';
  end if;
  v_paid := least(v_paid, v_total);
  if v_paid < v_total and v_supplier is null then
    raise exception 'Phiếu còn nợ: vui lòng chọn nhà cung cấp để theo dõi công nợ.' using errcode = 'P0001';
  end if;
  if v_paid < v_total then
    select s.payment_terms_days into v_terms from public.suppliers s where s.id = v_supplier;
    v_due := coalesce(v_due, case when v_terms is not null then v_date + v_terms end);
    if v_due is not null and v_due < v_date then
      raise exception 'Hạn thanh toán không được trước ngày hóa đơn.' using errcode = 'P0001';
    end if;
  else
    v_due := null;
  end if;

  update public.stock_receipts r
  set subtotal = v_subtotal, vat_amount = v_vat_total, total_amount = v_total, due_date = v_due
  where r.id = v_receipt;

  if v_paid > 0 then
    insert into public.supplier_payments (receipt_id, branch_id, supplier_id, amount, paid_on, method, note, created_by)
    values (v_receipt, v_branch, v_supplier, v_paid, private.vn_today(), v_method, 'Trả khi nhận hàng', v_me);
    perform private.refresh_receipt_paid(v_receipt);
  end if;

  if v_scan.id is not null then
    update public.invoice_scans s set receipt_id = v_receipt where s.id = v_scan.id;
  end if;
  return v_receipt;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. HỦY PHIẾU (thay bản cũ): tự hủy các lần thanh toán
-- ---------------------------------------------------------------------
create or replace function public.cancel_stock_receipt(p_receipt_id uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_receipt public.stock_receipts;
  v_line    public.stock_receipt_lines;
begin
  select * into v_receipt from public.stock_receipts r where r.id = p_receipt_id for update;
  if v_receipt.id is null or not private.manages_branch(v_receipt.branch_id) then
    raise exception 'Không tìm thấy phiếu nhập hoặc bạn không có quyền hủy.' using errcode = '42501';
  end if;
  if v_receipt.status <> 'posted' then
    raise exception 'Phiếu nhập này đã bị hủy trước đó.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Vui lòng nhập lý do hủy phiếu.' using errcode = 'P0001';
  end if;

  update public.stock_receipts r set
    status = 'cancelled', cancelled_at = now(), cancelled_by = private.current_employee_id(),
    cancel_reason = left(btrim(p_reason), 500)
  where r.id = v_receipt.id;

  update public.supplier_payments p set
    voided_at = now(), voided_by = private.current_employee_id(),
    void_reason = left('Hủy phiếu nhập: ' || btrim(p_reason), 500)
  where p.receipt_id = v_receipt.id and p.voided_at is null;
  perform private.refresh_receipt_paid(v_receipt.id);

  for v_line in select * from public.stock_receipt_lines l where l.receipt_id = v_receipt.id order by l.line_no loop
    perform private.apply_stock_change(v_receipt.branch_id, v_line.item_id, 'receipt_cancel', -v_line.base_quantity,
                                       v_receipt.id, left(btrim(p_reason), 500));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. GHI NHẬN / HỦY THANH TOÁN, ĐỔI HẠN (QTV / QL chi nhánh)
-- ---------------------------------------------------------------------
create or replace function public.record_supplier_payment(
  p_receipt_id uuid, p_amount numeric, p_paid_on date, p_method public.payment_method, p_note text default null
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_receipt public.stock_receipts;
  v_id      uuid;
begin
  select * into v_receipt from public.stock_receipts r where r.id = p_receipt_id for update;
  if v_receipt.id is null or not private.manages_branch(v_receipt.branch_id) then
    raise exception 'Không tìm thấy phiếu nhập hoặc bạn không có quyền ghi thanh toán.' using errcode = '42501';
  end if;
  if v_receipt.status <> 'posted' then
    raise exception 'Phiếu nhập đã bị hủy.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Số tiền trả phải lớn hơn 0.' using errcode = 'P0001';
  end if;
  if p_amount > v_receipt.debt_amount + 0.5 then
    raise exception 'Số tiền trả lớn hơn số còn nợ (% đ).', to_char(v_receipt.debt_amount, 'FM999G999G999G990') using errcode = 'P0001';
  end if;
  if p_paid_on is null or p_paid_on > private.vn_today() or p_paid_on < v_receipt.invoice_date - 30 then
    raise exception 'Ngày trả không hợp lệ.' using errcode = 'P0001';
  end if;

  insert into public.supplier_payments (receipt_id, branch_id, supplier_id, amount, paid_on, method, note, created_by)
  values (v_receipt.id, v_receipt.branch_id, v_receipt.supplier_id, least(p_amount, v_receipt.debt_amount),
          p_paid_on, coalesce(p_method, 'cash'), nullif(left(btrim(coalesce(p_note, '')), 300), ''), private.current_employee_id())
  returning id into v_id;
  perform private.refresh_receipt_paid(v_receipt.id);
  return v_id;
end;
$$;

create or replace function public.void_supplier_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_payment public.supplier_payments;
begin
  select * into v_payment from public.supplier_payments p where p.id = p_payment_id for update;
  if v_payment.id is null or not private.manages_branch(v_payment.branch_id) then
    raise exception 'Không tìm thấy lần thanh toán hoặc bạn không có quyền.' using errcode = '42501';
  end if;
  if v_payment.voided_at is not null then
    raise exception 'Lần thanh toán này đã bị hủy trước đó.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Vui lòng nhập lý do hủy.' using errcode = 'P0001';
  end if;
  update public.supplier_payments p set
    voided_at = now(), voided_by = private.current_employee_id(), void_reason = left(btrim(p_reason), 500)
  where p.id = v_payment.id;
  perform private.refresh_receipt_paid(v_payment.receipt_id);
end;
$$;

create or replace function public.set_receipt_due_date(p_receipt_id uuid, p_due_date date)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_receipt public.stock_receipts;
begin
  select * into v_receipt from public.stock_receipts r where r.id = p_receipt_id for update;
  if v_receipt.id is null or not private.manages_branch(v_receipt.branch_id) then
    raise exception 'Không tìm thấy phiếu nhập hoặc bạn không có quyền.' using errcode = '42501';
  end if;
  if p_due_date is not null and p_due_date < v_receipt.invoice_date then
    raise exception 'Hạn thanh toán không được trước ngày hóa đơn.' using errcode = 'P0001';
  end if;
  update public.stock_receipts r set due_date = p_due_date where r.id = v_receipt.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. QUYỀN & RLS
-- ---------------------------------------------------------------------
revoke all on function public.record_supplier_payment(uuid, numeric, date, public.payment_method, text) from public, anon;
revoke all on function public.void_supplier_payment(uuid, text) from public, anon;
revoke all on function public.set_receipt_due_date(uuid, date) from public, anon;
grant execute on function public.record_supplier_payment(uuid, numeric, date, public.payment_method, text) to authenticated;
grant execute on function public.void_supplier_payment(uuid, text) to authenticated;
grant execute on function public.set_receipt_due_date(uuid, date) to authenticated;

alter table public.supplier_payments enable row level security;
revoke all on public.supplier_payments from anon;
revoke insert, update, delete, truncate on public.supplier_payments from authenticated;

create policy "supplier_payments_select" on public.supplier_payments for select to authenticated
using ((select private.inventory_branch_access(branch_id)));
