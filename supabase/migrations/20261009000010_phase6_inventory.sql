-- =====================================================================
-- PHASE 6 — KHO: NHẬP KHO TỪ ẢNH HÓA ĐƠN + TỒN KHO
-- =====================================================================
-- Nghiệp vụ đã chốt (09/10/2026):
--   * Phạm vi: danh mục nguyên liệu, nhà cung cấp, tồn kho theo chi nhánh, phiếu nhập từ ảnh hóa đơn.
--     Xuất kho / kiểm kê để phase sau (tạm thời QTV/QL "điều chỉnh tồn" kèm lý do).
--   * Chụp ảnh hóa đơn → AI (Claude) đọc → màn hình xem lại, sửa → bấm Lưu mới cộng kho.
--   * Quyền nhập kho: QTV (mọi chi nhánh), Quản lý (chi nhánh mình), nhân viên khác khi QTV bật
--     "được nhập kho" (chi nhánh mình).
--   * Đơn vị: mỗi nguyên liệu có 1 đơn vị kho + các đơn vị quy đổi (1 thùng = 10 kg).
--     App nhớ "tên hàng trên hóa đơn → nguyên liệu + đơn vị" theo từng nhà cung cấp.
--   * Mặt hàng chưa có trong danh mục: người nhập tạo nhanh ngay khi lưu phiếu.
--   * Lưu đơn giá, thành tiền → lịch sử giá. Chưa theo dõi công nợ.
--   * Phiếu đã lưu không sửa; sai thì QTV/QL HỦY phiếu (kèm lý do, trừ lại tồn) rồi nhập lại.
--   * Chống nhập trùng: cùng nhà cung cấp + cùng số hóa đơn đã có phiếu → từ chối.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. QUYỀN NHẬP KHO CỦA NHÂN VIÊN
-- ---------------------------------------------------------------------
alter table public.employees
  add column can_receive_stock boolean not null default false;

comment on column public.employees.can_receive_stock is
  'Nhân viên (không phải QTV/QL) được nhập kho cho chi nhánh mình. Chỉ QTV thay đổi.';

create or replace function private.employees_stock_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  -- QTV & Quản lý luôn có quyền kho → cờ này không áp dụng
  if new.role in ('admin', 'manager') then
    new.can_receive_stock := false;
  end if;
  if (select auth.uid()) is not null
     and new.can_receive_stock is distinct from (case when tg_op = 'UPDATE' then old.can_receive_stock else false end)
     and not private.is_admin() then
    raise exception 'Chỉ Quản trị viên mới được cấp quyền nhập kho.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger employees_stock_guard
before insert or update on public.employees
for each row execute function private.employees_stock_guard();

-- Người đang đăng nhập có được vào module Kho không
create or replace function private.has_inventory_access()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.auth_user_id = (select auth.uid()) and e.is_active
      and (e.role in ('admin', 'manager') or e.can_receive_stock)
  )
$$;

-- Được xem kho / nhập kho tại chi nhánh này không
create or replace function private.inventory_branch_access(p_branch_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    where e.auth_user_id = (select auth.uid()) and e.is_active
      and (
        e.role = 'admin'
        or (
          (e.role = 'manager' or e.can_receive_stock)
          and exists (
            select 1 from public.employee_branches eb
            where eb.employee_id = e.id and eb.branch_id = p_branch_id
          )
        )
      )
  )
$$;

revoke all on function private.has_inventory_access() from public;
revoke all on function private.inventory_branch_access(uuid) from public;
grant execute on function private.has_inventory_access() to authenticated, service_role;
grant execute on function private.inventory_branch_access(uuid) to authenticated, service_role;

-- Server gọi (bằng phiên người dùng) trước khi tải ảnh / gọi AI
create or replace function public.can_receive_stock_at(p_branch_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.inventory_branch_access(p_branch_id)
    and exists (select 1 from public.branches b where b.id = p_branch_id and b.is_active)
$$;
revoke all on function public.can_receive_stock_at(uuid) from public, anon;
grant execute on function public.can_receive_stock_at(uuid) to authenticated;

-- Chuẩn hóa tên để so khớp (chữ thường, gộp khoảng trắng)
create or replace function private.norm_name(p_text text)
returns text
language sql immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g'))
$$;
revoke all on function private.norm_name(text) from public;
grant execute on function private.norm_name(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. NHÀ CUNG CẤP
-- ---------------------------------------------------------------------
create table public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  address    text,
  note       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees (id),

  constraint suppliers_name_len    check (char_length(btrim(name)) between 1 and 150),
  constraint suppliers_phone_len   check (phone is null or char_length(phone) <= 30),
  constraint suppliers_address_len check (address is null or char_length(address) <= 300),
  constraint suppliers_note_len    check (note is null or char_length(note) <= 500)
);
create unique index suppliers_name_key on public.suppliers (private.norm_name(name));
create index suppliers_created_idx on public.suppliers (created_by);
create index suppliers_updated_idx on public.suppliers (updated_by);

-- ---------------------------------------------------------------------
-- 3. DANH MỤC NGUYÊN LIỆU + ĐƠN VỊ QUY ĐỔI
-- ---------------------------------------------------------------------
create table public.inventory_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  category   text not null default 'Khác',
  base_unit  text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.employees (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees (id),

  constraint inventory_items_name_len     check (char_length(btrim(name)) between 1 and 150),
  constraint inventory_items_category_len check (char_length(btrim(category)) between 1 and 50),
  constraint inventory_items_unit_len     check (char_length(btrim(base_unit)) between 1 and 20)
);
create unique index inventory_items_name_key on public.inventory_items (private.norm_name(name));
create index inventory_items_created_idx on public.inventory_items (created_by);
create index inventory_items_updated_idx on public.inventory_items (updated_by);

-- 1 <unit_name> = <factor> <base_unit>
create table public.inventory_item_units (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.inventory_items (id),
  unit_name  text not null,
  factor     numeric(14, 4) not null,
  updated_at timestamptz not null default now(),

  constraint inventory_item_units_name_len check (char_length(btrim(unit_name)) between 1 and 20),
  constraint inventory_item_units_factor   check (factor > 0)
);
create unique index inventory_item_units_key on public.inventory_item_units (item_id, private.norm_name(unit_name));

-- Ghi nhớ: tên hàng trên hóa đơn (theo NCC) → nguyên liệu + đơn vị
create table public.inventory_aliases (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers (id),
  alias_norm  text not null,
  item_id     uuid not null references public.inventory_items (id),
  unit_name   text not null,
  factor      numeric(14, 4) not null,
  updated_at  timestamptz not null default now(),

  constraint inventory_aliases_len    check (char_length(alias_norm) between 1 and 200),
  constraint inventory_aliases_factor check (factor > 0)
);
create unique index inventory_aliases_key
  on public.inventory_aliases (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), alias_norm);
create index inventory_aliases_item_idx on public.inventory_aliases (item_id);
create index inventory_aliases_supplier_idx on public.inventory_aliases (supplier_id);

create or replace function private.inventory_master_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  if tg_table_name = 'inventory_items' then
    new.category  := btrim(new.category);
    new.base_unit := btrim(new.base_unit);
  else
    new.phone   := nullif(btrim(new.phone), '');
    new.address := nullif(btrim(new.address), '');
    new.note    := nullif(btrim(new.note), '');
  end if;
  new.updated_at := now();
  new.updated_by := private.current_employee_id();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := private.current_employee_id();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger suppliers_guard before insert or update on public.suppliers
for each row execute function private.inventory_master_guard();
create trigger inventory_items_guard before insert or update on public.inventory_items
for each row execute function private.inventory_master_guard();

-- Đổi đơn vị kho khi đã có tồn / phiếu nhập sẽ làm sai số liệu → chặn
create or replace function private.inventory_items_unit_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.base_unit is distinct from old.base_unit
     and exists (select 1 from public.stock_movements m where m.item_id = new.id) then
    raise exception 'Nguyên liệu đã có phát sinh nhập/tồn nên không đổi được đơn vị kho.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger suppliers_forbid_delete before delete on public.suppliers
for each row execute function private.forbid_delete();
create trigger inventory_items_forbid_delete before delete on public.inventory_items
for each row execute function private.forbid_delete();
create trigger suppliers_audit after insert or update on public.suppliers
for each row execute function private.write_audit_log();
create trigger inventory_items_audit after insert or update on public.inventory_items
for each row execute function private.write_audit_log();
create trigger inventory_item_units_audit after insert or update or delete on public.inventory_item_units
for each row execute function private.write_audit_log();

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger inventory_item_units_touch before insert or update on public.inventory_item_units
for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------
-- 4. LƯỢT QUÉT ẢNH HÓA ĐƠN (ghi chi phí AI, dọn ảnh bỏ dở)
-- ---------------------------------------------------------------------
create table public.invoice_scans (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches (id),
  employee_id     uuid not null references public.employees (id),
  photo_path      text not null,
  model           text,
  input_tokens    integer,
  output_tokens   integer,
  result          jsonb,
  error           text,
  receipt_id      uuid,
  photo_purged_at timestamptz,
  created_at      timestamptz not null default now()
);
create index invoice_scans_employee_idx on public.invoice_scans (employee_id, created_at);
create index invoice_scans_branch_idx   on public.invoice_scans (branch_id, created_at);
create index invoice_scans_purge_idx    on public.invoice_scans (created_at) where photo_purged_at is null;

-- ---------------------------------------------------------------------
-- 5. PHIẾU NHẬP + DÒNG PHIẾU
-- ---------------------------------------------------------------------
create type public.stock_receipt_status as enum ('posted', 'cancelled');

create table public.stock_receipts (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches (id),
  supplier_id    uuid references public.suppliers (id),
  invoice_number text,
  invoice_date   date not null,
  invoice_total  numeric(16, 2),          -- tổng in trên hóa đơn (để đối chiếu)
  total_amount   numeric(16, 2) not null, -- tổng các dòng đã nhập
  note           text,
  scan_id        uuid references public.invoice_scans (id),
  photo_path     text,
  status         public.stock_receipt_status not null default 'posted',
  created_at     timestamptz not null default now(),
  created_by     uuid not null references public.employees (id),
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.employees (id),
  cancel_reason  text,

  constraint stock_receipts_invoice_len check (invoice_number is null or char_length(invoice_number) <= 50),
  constraint stock_receipts_note_len    check (note is null or char_length(note) <= 500),
  constraint stock_receipts_total       check (total_amount >= 0 and (invoice_total is null or invoice_total >= 0)),
  constraint stock_receipts_cancel      check ((status = 'cancelled') = (cancelled_at is not null and cancelled_by is not null))
);
create index stock_receipts_branch_idx   on public.stock_receipts (branch_id, invoice_date desc);
create index stock_receipts_supplier_idx on public.stock_receipts (supplier_id, invoice_number);
create index stock_receipts_created_idx  on public.stock_receipts (created_by);
create index stock_receipts_cancel_idx   on public.stock_receipts (cancelled_by);
create index stock_receipts_scan_idx     on public.stock_receipts (scan_id);

alter table public.invoice_scans
  add constraint invoice_scans_receipt_fk foreign key (receipt_id) references public.stock_receipts (id);
create index invoice_scans_receipt_idx on public.invoice_scans (receipt_id);

create table public.stock_receipt_lines (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references public.stock_receipts (id),
  line_no       smallint not null,
  item_id       uuid not null references public.inventory_items (id),
  raw_name      text,                     -- tên hàng ghi trên hóa đơn
  quantity      numeric(14, 3) not null,  -- theo đơn vị trên hóa đơn
  unit_name     text not null,
  factor        numeric(14, 4) not null,  -- 1 unit_name = factor đơn vị kho (chụp lúc nhập)
  base_quantity numeric(16, 4) not null,  -- quantity × factor
  unit_price    numeric(16, 2) not null,  -- đơn giá theo unit_name
  amount        numeric(16, 2) not null,

  constraint stock_receipt_lines_unique unique (receipt_id, line_no),
  constraint stock_receipt_lines_values check (quantity > 0 and factor > 0 and base_quantity > 0 and unit_price >= 0 and amount >= 0),
  constraint stock_receipt_lines_raw_len check (raw_name is null or char_length(raw_name) <= 200)
);
create index stock_receipt_lines_item_idx on public.stock_receipt_lines (item_id);

-- ---------------------------------------------------------------------
-- 6. TỒN KHO + SỔ PHÁT SINH
-- ---------------------------------------------------------------------
create type public.stock_movement_kind as enum ('receipt', 'receipt_cancel', 'adjust');

create table public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches (id),
  item_id       uuid not null references public.inventory_items (id),
  kind          public.stock_movement_kind not null,
  change        numeric(16, 4) not null,
  balance_after numeric(16, 4) not null,
  receipt_id    uuid references public.stock_receipts (id),
  reason        text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.employees (id)
);
create index stock_movements_item_idx    on public.stock_movements (branch_id, item_id, created_at desc);
create index stock_movements_item_only   on public.stock_movements (item_id);
create index stock_movements_receipt_idx on public.stock_movements (receipt_id);
create index stock_movements_created_idx on public.stock_movements (created_by);

create table public.stock_balances (
  branch_id  uuid not null references public.branches (id),
  item_id    uuid not null references public.inventory_items (id),
  quantity   numeric(16, 4) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (branch_id, item_id)
);
create index stock_balances_item_idx on public.stock_balances (item_id);

create trigger inventory_items_unit_guard before update on public.inventory_items
for each row execute function private.inventory_items_unit_guard();

create trigger stock_receipts_forbid_delete before delete on public.stock_receipts
for each row execute function private.forbid_delete();
create trigger stock_receipt_lines_forbid_delete before delete on public.stock_receipt_lines
for each row execute function private.forbid_delete();
create trigger stock_movements_forbid_delete before delete on public.stock_movements
for each row execute function private.forbid_delete();
create trigger stock_receipts_audit after insert or update on public.stock_receipts
for each row execute function private.write_audit_log();

-- Ghi 1 phát sinh + cập nhật tồn (nội bộ)
create or replace function private.apply_stock_change(
  p_branch_id uuid, p_item_id uuid, p_kind public.stock_movement_kind,
  p_change numeric, p_receipt_id uuid, p_reason text
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

  insert into public.stock_movements (branch_id, item_id, kind, change, balance_after, receipt_id, reason, created_by)
  values (p_branch_id, p_item_id, p_kind, p_change, v_balance, p_receipt_id, p_reason, private.current_employee_id());
  return v_balance;
end;
$$;
revoke all on function private.apply_stock_change(uuid, uuid, public.stock_movement_kind, numeric, uuid, text) from public;

-- ---------------------------------------------------------------------
-- 7. RPC: LƯU PHIẾU NHẬP (1 giao dịch: tạo NCC/nguyên liệu mới, ghi nhớ, cộng tồn)
-- ---------------------------------------------------------------------
-- p_payload:
-- {
--   "branch_id": uuid, "scan_id": uuid|null,
--   "supplier_id": uuid|null, "new_supplier_name": text|null,
--   "invoice_number": text|null, "invoice_date": "YYYY-MM-DD", "invoice_total": number|null, "note": text|null,
--   "lines": [{
--     "item_id": uuid|null,
--     "new_item": {"name": text, "category": text, "base_unit": text}|null,
--     "raw_name": text|null, "quantity": number, "unit_name": text, "factor": number,
--     "unit_price": number, "amount": number
--   }]
-- }
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
  v_raw         text;
  v_total       numeric := 0;
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

  -- Ảnh đã quét: phải của chính mình, cùng chi nhánh, chưa dùng cho phiếu khác
  if v_scan_id is not null then
    select * into v_scan from public.invoice_scans s where s.id = v_scan_id for update;
    if v_scan.id is null or v_scan.employee_id <> v_me or v_scan.branch_id <> v_branch then
      raise exception 'Ảnh hóa đơn không hợp lệ.' using errcode = 'P0001';
    end if;
    if v_scan.receipt_id is not null then
      raise exception 'Ảnh hóa đơn này đã được lưu thành phiếu nhập.' using errcode = 'P0001';
    end if;
  end if;

  -- Nhà cung cấp: chọn có sẵn, hoặc tạo mới (trùng tên → dùng NCC cũ)
  if v_supplier is null and v_new_sup is not null then
    select s.id into v_supplier from public.suppliers s where private.norm_name(s.name) = private.norm_name(v_new_sup);
    if v_supplier is null then
      insert into public.suppliers (name) values (left(v_new_sup, 150)) returning id into v_supplier;
    end if;
  elsif v_supplier is not null and not exists (select 1 from public.suppliers s where s.id = v_supplier) then
    raise exception 'Không tìm thấy nhà cung cấp.' using errcode = 'P0001';
  end if;

  -- Chống nhập trùng hóa đơn
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
    v_unit   := regexp_replace(btrim(coalesce(v_line ->> 'unit_name', '')), '\s+', ' ', 'g');
    v_raw    := nullif(regexp_replace(btrim(coalesce(v_line ->> 'raw_name', '')), '\s+', ' ', 'g'), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'Dòng %: số lượng phải lớn hơn 0.', v_no using errcode = 'P0001';
    end if;
    if v_price < 0 or v_amount < 0 then
      raise exception 'Dòng %: đơn giá / thành tiền không hợp lệ.', v_no using errcode = 'P0001';
    end if;

    -- Nguyên liệu: chọn có sẵn hoặc tạo nhanh (trùng tên → dùng cái cũ)
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

    -- Đơn vị: trùng đơn vị kho → hệ số 1; khác → bắt buộc hệ số, ghi nhớ quy đổi
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
      receipt_id, line_no, item_id, raw_name, quantity, unit_name, factor, base_quantity, unit_price, amount
    ) values (
      v_receipt, v_no, v_item, left(v_raw, 200), v_qty, left(v_unit, 20), v_factor,
      round(v_qty * v_factor, 4), v_price, v_amount
    );
    v_total := v_total + v_amount;

    -- Ghi nhớ tên trên hóa đơn → nguyên liệu (theo NCC)
    if v_raw is not null then
      insert into public.inventory_aliases as a (supplier_id, alias_norm, item_id, unit_name, factor)
      values (v_supplier, left(private.norm_name(v_raw), 200), v_item, left(v_unit, 20), v_factor)
      on conflict (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid), alias_norm) do update
        set item_id = excluded.item_id, unit_name = excluded.unit_name, factor = excluded.factor, updated_at = now();
    end if;

    perform private.apply_stock_change(v_branch, v_item, 'receipt', round(v_qty * v_factor, 4), v_receipt, null);
  end loop;

  update public.stock_receipts r set total_amount = v_total where r.id = v_receipt;
  if v_scan.id is not null then
    update public.invoice_scans s set receipt_id = v_receipt where s.id = v_scan.id;
  end if;
  return v_receipt;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. RPC: HỦY PHIẾU NHẬP (QTV / QL chi nhánh) — trừ lại tồn
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

  for v_line in select * from public.stock_receipt_lines l where l.receipt_id = v_receipt.id order by l.line_no loop
    perform private.apply_stock_change(v_receipt.branch_id, v_line.item_id, 'receipt_cancel', -v_line.base_quantity,
                                       v_receipt.id, left(btrim(p_reason), 500));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. RPC: ĐIỀU CHỈNH TỒN (QTV / QL chi nhánh) — đặt số tồn thực tế, kèm lý do
-- ---------------------------------------------------------------------
create or replace function public.adjust_stock(p_branch_id uuid, p_item_id uuid, p_new_quantity numeric, p_reason text)
returns numeric
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_current numeric;
begin
  if not private.manages_branch(p_branch_id) then
    raise exception 'Bạn không có quyền điều chỉnh tồn kho chi nhánh này.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.inventory_items i where i.id = p_item_id) then
    raise exception 'Không tìm thấy nguyên liệu.' using errcode = 'P0001';
  end if;
  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Số tồn thực tế phải từ 0 trở lên.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Vui lòng nhập lý do điều chỉnh.' using errcode = 'P0001';
  end if;

  select b.quantity into v_current from public.stock_balances b
  where b.branch_id = p_branch_id and b.item_id = p_item_id for update;
  if coalesce(v_current, 0) = p_new_quantity then
    raise exception 'Số tồn không thay đổi.' using errcode = 'P0001';
  end if;
  return private.apply_stock_change(p_branch_id, p_item_id, 'adjust', p_new_quantity - coalesce(v_current, 0),
                                    null, left(btrim(p_reason), 500));
end;
$$;

-- ---------------------------------------------------------------------
-- 10. DỌN ẢNH HÓA ĐƠN
--   * Ảnh quét nhưng không lưu thành phiếu: xóa sau 1 ngày.
--   * Ảnh của phiếu nhập: giữ 12 tháng (chứng từ), sau đó xóa ảnh, giữ số liệu.
-- ---------------------------------------------------------------------
create or replace function public.service_invoice_photos_to_purge(p_limit integer default 500)
returns table (id uuid, photo_path text)
language sql stable security definer
set search_path = ''
as $$
  select s.id, s.photo_path
  from public.invoice_scans s
  where s.photo_purged_at is null
    and (
      (s.receipt_id is null and s.created_at < now() - interval '1 day')
      or s.created_at < now() - interval '12 months'
    )
  order by s.created_at
  limit least(greatest(p_limit, 1), 1000)
$$;

create or replace function public.service_mark_invoice_photos_purged(p_ids uuid[])
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.invoice_scans s set photo_purged_at = now() where s.id = any (p_ids) and s.photo_purged_at is null;
  update public.stock_receipts r set photo_path = null
  where r.scan_id = any (p_ids) and r.photo_path is not null;
$$;

create or replace function private.run_daily_cleanup()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  -- Thông báo trên app giữ 60 ngày
  delete from public.notifications n where n.created_at < now() - interval '60 days';

  if exists (
    select 1 from public.task_instances t
    where t.photo_path is not null and t.photo_purged_at is null
      and coalesce(t.completed_at, t.created_at) < now() - interval '3 months'
  ) or exists (
    select 1 from public.invoice_scans s
    where s.photo_purged_at is null
      and ((s.receipt_id is null and s.created_at < now() - interval '1 day') or s.created_at < now() - interval '12 months')
  ) then
    perform private.call_ops_job('cleanup');
  end if;
end;
$$;
revoke all on function private.run_daily_cleanup() from public;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoice-photos', 'invoice-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 11. QUYỀN THỰC THI HÀM
-- ---------------------------------------------------------------------
revoke all on function public.create_stock_receipt(jsonb) from public, anon;
revoke all on function public.cancel_stock_receipt(uuid, text) from public, anon;
revoke all on function public.adjust_stock(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.create_stock_receipt(jsonb) to authenticated;
grant execute on function public.cancel_stock_receipt(uuid, text) to authenticated;
grant execute on function public.adjust_stock(uuid, uuid, numeric, text) to authenticated;

revoke all on function public.service_invoice_photos_to_purge(integer) from public, anon, authenticated;
revoke all on function public.service_mark_invoice_photos_purged(uuid[]) from public, anon, authenticated;
grant execute on function public.service_invoice_photos_to_purge(integer) to service_role;
grant execute on function public.service_mark_invoice_photos_purged(uuid[]) to service_role;

revoke all on function private.inventory_master_guard() from public;
revoke all on function private.inventory_items_unit_guard() from public;
revoke all on function private.employees_stock_guard() from public;
revoke all on function private.touch_updated_at() from public;

-- ---------------------------------------------------------------------
-- 12. RLS
-- ---------------------------------------------------------------------
alter table public.suppliers            enable row level security;
alter table public.inventory_items      enable row level security;
alter table public.inventory_item_units enable row level security;
alter table public.inventory_aliases    enable row level security;
alter table public.invoice_scans        enable row level security;
alter table public.stock_receipts       enable row level security;
alter table public.stock_receipt_lines  enable row level security;
alter table public.stock_movements      enable row level security;
alter table public.stock_balances       enable row level security;

revoke all on public.suppliers, public.inventory_items, public.inventory_item_units, public.inventory_aliases,
  public.invoice_scans, public.stock_receipts, public.stock_receipt_lines, public.stock_movements,
  public.stock_balances from anon;
revoke delete, truncate on public.suppliers, public.inventory_items from authenticated;
revoke truncate on public.inventory_item_units, public.inventory_aliases from authenticated;
revoke insert, update on public.inventory_aliases from authenticated;
revoke insert, update, delete, truncate on public.invoice_scans, public.stock_receipts, public.stock_receipt_lines,
  public.stock_movements, public.stock_balances from authenticated;

-- Danh mục: ai có quyền kho đều xem; QTV/QL sửa
create policy "suppliers_select" on public.suppliers for select to authenticated
using ((select private.has_inventory_access()));
create policy "suppliers_insert" on public.suppliers for insert to authenticated
with check ((select private.is_manager_or_admin()));
create policy "suppliers_update" on public.suppliers for update to authenticated
using ((select private.is_manager_or_admin())) with check ((select private.is_manager_or_admin()));

create policy "inventory_items_select" on public.inventory_items for select to authenticated
using ((select private.has_inventory_access()));
create policy "inventory_items_insert" on public.inventory_items for insert to authenticated
with check ((select private.is_manager_or_admin()));
create policy "inventory_items_update" on public.inventory_items for update to authenticated
using ((select private.is_manager_or_admin())) with check ((select private.is_manager_or_admin()));

create policy "inventory_item_units_select" on public.inventory_item_units for select to authenticated
using ((select private.has_inventory_access()));
create policy "inventory_item_units_insert" on public.inventory_item_units for insert to authenticated
with check ((select private.is_manager_or_admin()));
create policy "inventory_item_units_update" on public.inventory_item_units for update to authenticated
using ((select private.is_manager_or_admin())) with check ((select private.is_manager_or_admin()));
create policy "inventory_item_units_delete" on public.inventory_item_units for delete to authenticated
using ((select private.is_manager_or_admin()));

create policy "inventory_aliases_select" on public.inventory_aliases for select to authenticated
using ((select private.has_inventory_access()));
create policy "inventory_aliases_delete" on public.inventory_aliases for delete to authenticated
using ((select private.is_manager_or_admin()));

-- Lượt quét: người quét, hoặc QTV/QL chi nhánh
create policy "invoice_scans_select" on public.invoice_scans for select to authenticated
using (
  employee_id = (select private.current_employee_id())
  or (select private.manages_branch(branch_id))
);

-- Phiếu nhập, tồn kho: theo chi nhánh được vào kho
create policy "stock_receipts_select" on public.stock_receipts for select to authenticated
using ((select private.inventory_branch_access(branch_id)));
create policy "stock_receipt_lines_select" on public.stock_receipt_lines for select to authenticated
using (exists (
  select 1 from public.stock_receipts r
  where r.id = receipt_id and (select private.inventory_branch_access(r.branch_id))
));
create policy "stock_movements_select" on public.stock_movements for select to authenticated
using ((select private.inventory_branch_access(branch_id)));
create policy "stock_balances_select" on public.stock_balances for select to authenticated
using ((select private.inventory_branch_access(branch_id)));
