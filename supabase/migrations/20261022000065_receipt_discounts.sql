-- =====================================================================
-- PHIẾU NHẬP: KHUYẾN MÃI / CHIẾT KHẤU + HÀNG TẶNG
-- =====================================================================
-- Nghiệp vụ đã chốt (22/10/2026):
--   * Chiết khấu tính TRƯỚC VAT (chiết khấu thương mại ghi trên hóa đơn làm giảm giá tính thuế):
--     tiền thuế dòng = (thành tiền − CK dòng − phần CK tổng HĐ) × thuế suất.
--   * Chiết khấu trên dòng (discount_amount): giảm % hoặc số tiền của riêng món đó (app đổi % ra số tiền).
--   * Chiết khấu trên tổng hóa đơn (order_discount): vẫn lưu & hiện thành MỘT KHOẢN RIÊNG ở phiếu,
--     đồng thời chia về các dòng theo tỉ lệ tiền (sau CK dòng) để giá vốn từng nguyên liệu đúng.
--     Làm tròn đến đồng, phần lẻ dồn vào dòng có tiền lớn nhất (dòng đầu tiên nếu bằng nhau) — khớp lib/inventory.ts.
--   * Hàng tặng (is_gift): giá 0 đồng, vẫn cộng tồn kho; không dùng làm "giá nhập gần nhất".
--   * Giá vốn dòng (cost_amount) = thành tiền − CK dòng − phần CK tổng HĐ + VAT.
--   * Phiếu: tiền hàng (subtotal, trước CK) − chiết khấu (discount_amount = CK dòng + CK tổng HĐ) + VAT = tổng thanh toán.
-- =====================================================================

alter table public.stock_receipt_lines
  add column discount_amount numeric(16, 2) not null default 0,
  add column order_discount  numeric(16, 2) not null default 0,
  add column is_gift         boolean not null default false,
  add constraint stock_receipt_lines_discount check (
    discount_amount >= 0 and order_discount >= 0 and discount_amount + order_discount <= amount
  ),
  add constraint stock_receipt_lines_gift check (not is_gift or (amount = 0 and unit_price = 0));

alter table public.stock_receipt_lines
  add column cost_amount numeric(16, 2) generated always as (amount - discount_amount - order_discount + vat_amount) stored;

comment on column public.stock_receipt_lines.discount_amount is 'Chiết khấu riêng của dòng (TRƯỚC VAT)';
comment on column public.stock_receipt_lines.order_discount is 'Phần chiết khấu tổng hóa đơn chia về dòng này (TRƯỚC VAT)';
comment on column public.stock_receipt_lines.is_gift is 'Hàng tặng / khuyến mãi 0 đồng (vẫn cộng tồn kho)';
comment on column public.stock_receipt_lines.cost_amount is 'Giá vốn của dòng = thành tiền − chiết khấu + VAT';

alter table public.stock_receipts
  add column discount_amount numeric(16, 2) not null default 0,
  add column order_discount  numeric(16, 2) not null default 0,
  add constraint stock_receipts_discount check (discount_amount >= 0 and order_discount >= 0 and order_discount <= discount_amount);

comment on column public.stock_receipts.subtotal is 'Tiền hàng TRƯỚC chiết khấu, trước VAT';
comment on column public.stock_receipts.discount_amount is 'Tổng chiết khấu (CK dòng + CK tổng HĐ), trước VAT';
comment on column public.stock_receipts.order_discount is 'Chiết khấu / giảm giá trên tổng hóa đơn, trước VAT';
comment on column public.stock_receipts.total_amount is 'Tổng thanh toán = subtotal − discount_amount + vat_amount';

-- Giá vốn hiện tại: giá nhập gần nhất SAU chiết khấu, SAU VAT / 1 đơn vị kho (khớp loadLastPrices phía app)
create or replace function private.item_unit_cost(p_item_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select round(l.cost_amount / l.base_quantity, 4)
  from public.stock_receipt_lines l
  join public.stock_receipts r on r.id = l.receipt_id and r.status = 'posted'
  where l.item_id = p_item_id and l.base_quantity > 0 and l.cost_amount > 0
  order by r.invoice_date desc, r.created_at desc, l.line_no
  limit 1
$$;
revoke all on function private.item_unit_cost(uuid) from public;

-- ---------------------------------------------------------------------
-- LƯU PHIẾU NHẬP (thay bản cũ)
-- ---------------------------------------------------------------------
-- p_payload thêm:
--   "order_discount": number ≥ 0 (chiết khấu tổng HĐ, trước VAT)
--   lines[].discount_amount: number ≥ 0 (chiết khấu dòng, trước VAT, ≤ amount)
--   lines[].is_gift: boolean (hàng tặng: đơn giá / thành tiền / CK phải = 0)
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
  v_order_disc  numeric := round(coalesce(nullif(p_payload ->> 'order_discount', '')::numeric, 0), 0);
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
  v_disc        numeric;
  v_gift        boolean;
  v_alloc       numeric;
  v_rate        numeric;
  v_vat         numeric;
  v_raw         text;
  v_net_total   numeric := 0;
  v_max_net     numeric := -1;
  v_max_no      smallint := 0;
  v_alloc_sum   numeric := 0;
  v_subtotal    numeric := 0;
  v_disc_total  numeric := 0;
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
  if v_order_disc < 0 then
    raise exception 'Chiết khấu tổng hóa đơn không hợp lệ.' using errcode = 'P0001';
  end if;

  -- Lượt 1: kiểm tra tiền / chiết khấu từng dòng, tính tiền sau CK dòng để chia CK tổng HĐ
  for v_line in select * from jsonb_array_elements(p_payload -> 'lines') loop
    v_no     := v_no + 1;
    v_price  := coalesce(nullif(v_line ->> 'unit_price', '')::numeric, 0);
    v_amount := coalesce(nullif(v_line ->> 'amount', '')::numeric, 0);
    v_disc   := coalesce(nullif(v_line ->> 'discount_amount', '')::numeric, 0);
    v_gift   := coalesce((v_line ->> 'is_gift')::boolean, false);
    if v_price < 0 or v_amount < 0 then
      raise exception 'Dòng %: đơn giá / thành tiền không hợp lệ.', v_no using errcode = 'P0001';
    end if;
    if v_disc < 0 or v_disc > v_amount then
      raise exception 'Dòng %: chiết khấu phải từ 0 đến thành tiền của dòng.', v_no using errcode = 'P0001';
    end if;
    if v_gift and (v_price <> 0 or v_amount <> 0 or v_disc <> 0) then
      raise exception 'Dòng %: hàng tặng phải có đơn giá và thành tiền 0 đồng.', v_no using errcode = 'P0001';
    end if;
    v_net_total := v_net_total + (v_amount - v_disc);
    if v_amount - v_disc > v_max_net then
      v_max_net := v_amount - v_disc;
      v_max_no := v_no;
    end if;
  end loop;
  if v_order_disc > v_net_total then
    raise exception 'Chiết khấu tổng hóa đơn lớn hơn tiền hàng.' using errcode = 'P0001';
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

  -- Lượt 2: lưu từng dòng
  v_no := 0;
  for v_line in select * from jsonb_array_elements(p_payload -> 'lines') loop
    v_no     := v_no + 1;
    v_item   := nullif(v_line ->> 'item_id', '')::uuid;
    v_qty    := (v_line ->> 'quantity')::numeric;
    v_factor := (v_line ->> 'factor')::numeric;
    v_price  := coalesce(nullif(v_line ->> 'unit_price', '')::numeric, 0);
    v_amount := coalesce(nullif(v_line ->> 'amount', '')::numeric, 0);
    v_disc   := coalesce(nullif(v_line ->> 'discount_amount', '')::numeric, 0);
    v_gift   := coalesce((v_line ->> 'is_gift')::boolean, false);
    v_rate   := coalesce(nullif(v_line ->> 'vat_rate', '')::numeric, 0);
    v_unit   := regexp_replace(btrim(coalesce(v_line ->> 'unit_name', '')), '\s+', ' ', 'g');
    v_raw    := nullif(regexp_replace(btrim(coalesce(v_line ->> 'raw_name', '')), '\s+', ' ', 'g'), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'Dòng %: số lượng phải lớn hơn 0.', v_no using errcode = 'P0001';
    end if;
    if v_rate < 0 or v_rate > 100 then
      raise exception 'Dòng %: thuế suất VAT không hợp lệ.', v_no using errcode = 'P0001';
    end if;

    -- Phần CK tổng HĐ của dòng: theo tỉ lệ tiền sau CK dòng; dòng tiền lớn nhất nhận phần lẻ (tính ở cuối)
    if v_order_disc = 0 or v_net_total = 0 or v_no = v_max_no then
      v_alloc := 0;
    else
      v_alloc := round(v_order_disc * (v_amount - v_disc) / v_net_total, 0);
    end if;
    v_alloc_sum := v_alloc_sum + v_alloc;
    v_vat := round((v_amount - v_disc - v_alloc) * v_rate / 100, 0);

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
      receipt_id, line_no, item_id, raw_name, quantity, unit_name, factor, base_quantity, unit_price, amount,
      discount_amount, order_discount, is_gift, vat_rate, vat_amount
    ) values (
      v_receipt, v_no, v_item, left(v_raw, 200), v_qty, left(v_unit, 20), v_factor,
      round(v_qty * v_factor, 4), v_price, v_amount, v_disc, v_alloc, v_gift, v_rate, v_vat
    );
    v_subtotal   := v_subtotal + v_amount;
    v_disc_total := v_disc_total + v_disc;
    v_vat_total  := v_vat_total + v_vat;

    if v_raw is not null then
      insert into public.inventory_aliases as a (supplier_id, alias_norm, item_id, unit_name, factor)
      values (v_supplier, left(private.norm_name(v_raw), 200), v_item, left(v_unit, 20), v_factor)
      on conflict (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), alias_norm) do update
        set item_id = excluded.item_id, unit_name = excluded.unit_name, factor = excluded.factor, updated_at = now();
    end if;

    perform private.apply_stock_change(v_branch, v_item, 'receipt', round(v_qty * v_factor, 4), v_receipt, null);
  end loop;

  -- Phần lẻ CK tổng HĐ → dòng tiền lớn nhất, tính lại VAT của dòng đó
  if v_order_disc > 0 and v_max_no > 0 then
    v_alloc := v_order_disc - v_alloc_sum;
    if v_alloc < 0 then
      raise exception 'Không chia được chiết khấu tổng hóa đơn về các dòng.' using errcode = 'P0001';
    end if;
    select l.amount - l.discount_amount, l.vat_rate, l.vat_amount into v_amount, v_rate, v_vat
    from public.stock_receipt_lines l where l.receipt_id = v_receipt and l.line_no = v_max_no;
    if v_alloc > v_amount then
      raise exception 'Không chia được chiết khấu tổng hóa đơn về các dòng.' using errcode = 'P0001';
    end if;
    v_vat_total := v_vat_total - v_vat + round((v_amount - v_alloc) * v_rate / 100, 0);
    update public.stock_receipt_lines l
    set order_discount = v_alloc, vat_amount = round((v_amount - v_alloc) * v_rate / 100, 0)
    where l.receipt_id = v_receipt and l.line_no = v_max_no;
  end if;

  v_disc_total := v_disc_total + v_order_disc;
  v_total := v_subtotal - v_disc_total + v_vat_total;

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
  set subtotal = v_subtotal, discount_amount = v_disc_total, order_discount = v_order_disc,
      vat_amount = v_vat_total, total_amount = v_total, due_date = v_due
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
