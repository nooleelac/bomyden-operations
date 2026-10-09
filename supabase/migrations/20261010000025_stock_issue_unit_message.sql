-- Sửa thông báo lỗi đơn vị chưa có quy đổi (hiện tên đơn vị thay vì NULL)
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
