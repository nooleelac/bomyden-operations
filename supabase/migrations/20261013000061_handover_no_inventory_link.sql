-- =====================================================================
-- BÀN GIAO CA: BỎ LIÊN KẾT DANH MỤC KHO (13/10/2026)
-- =====================================================================
--   * Danh mục kho có nhóm nguyên liệu nhạy cảm → nhân viên KHÔNG được thấy tên nguyên liệu kho qua Bàn giao ca.
--   * Mọi món bàn giao do QTV tự gõ tên + đơn vị (chỉ dùng để bàn giao, không ảnh hưởng tồn kho).
--   * QL vẫn sắp xếp / bật tắt ảnh / gỡ món; chỉ QTV thêm, đổi tên, đổi đơn vị.
--   * Lúc áp dụng chưa có món / phiếu nào → xóa thẳng cột item_id.
-- =====================================================================

-- Nhân viên không còn đọc được tên nguyên liệu kho
drop policy if exists "inventory_items_select_handover" on public.inventory_items;

-- (xóa cột → tự xóa ràng buộc / chỉ mục dính tới item_id)
alter table public.handover_items drop column item_id;
alter table public.handover_items alter column name set not null;
create unique index handover_items_name_key on public.handover_items (branch_id, private.norm_name(name));

alter table public.shift_handover_lines drop column item_id;

create or replace function private.handover_items_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.unit := btrim(new.unit);
  new.name := btrim(new.name);
  if (tg_op = 'INSERT' or new.name is distinct from old.name or new.unit is distinct from old.unit)
     and private.current_employee_role() is distinct from 'admin' then
    raise exception 'Chỉ Quản trị viên được thêm món / đổi tên, đơn vị.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, private.current_employee_id());
  else
    new.branch_id := old.branch_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := private.current_employee_id();
  return new;
end;
$$;

-- p_lines: [{ "handover_item_id": uuid, "quantity": number, "photo_path": text|null }, ...]
create or replace function public.create_shift_handover(p_branch_id uuid, p_note text, p_lines jsonb)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_employee_id();
  v_name   text;
  v_branch text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_id     uuid;
  v_cfg    record;
  v_line   jsonb;
  v_qty    numeric;
  v_path   text;
  v_count  integer := 0;
begin
  if v_me is null then
    raise exception 'Tài khoản không hợp lệ.' using errcode = '42501';
  end if;
  if not (private.in_my_branch(p_branch_id) or private.manages_branch(p_branch_id)) then
    raise exception 'Bạn không thuộc chi nhánh này.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'Dữ liệu bàn giao không hợp lệ.' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Ghi chú quá dài (tối đa 1000 ký tự).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.handover_items h where h.branch_id = p_branch_id) then
    raise exception 'Chi nhánh chưa có danh sách món bàn giao. Nhờ Quản trị viên thiết lập trước.' using errcode = 'P0001';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (select count(distinct l ->> 'handover_item_id') from jsonb_array_elements(p_lines) l) then
    raise exception 'Có món bị nhập trùng.' using errcode = 'P0001';
  end if;
  if (select count(l ->> 'photo_path') from jsonb_array_elements(p_lines) l where nullif(l ->> 'photo_path', '') is not null)
     <> (select count(distinct l ->> 'photo_path') from jsonb_array_elements(p_lines) l where nullif(l ->> 'photo_path', '') is not null) then
    raise exception 'Mỗi món cần một ảnh riêng.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where not exists (
      select 1 from public.handover_items h where h.branch_id = p_branch_id and h.id::text = l ->> 'handover_item_id'
    )
  ) then
    raise exception 'Danh sách món bàn giao vừa thay đổi. Tải lại trang rồi nhập lại.' using errcode = 'P0001';
  end if;

  select e.full_name into v_name from public.employees e where e.id = v_me;
  insert into public.shift_handovers (branch_id, handed_by, handed_by_name, note)
  values (p_branch_id, v_me, v_name, v_note)
  returning id into v_id;

  for v_cfg in
    select h.id, h.name, h.unit, h.requires_photo
    from public.handover_items h
    where h.branch_id = p_branch_id
    order by h.sort_order, h.created_at
  loop
    select l into v_line from jsonb_array_elements(p_lines) l where l ->> 'handover_item_id' = v_cfg.id::text;
    if v_line is null or nullif(v_line ->> 'quantity', '') is null then
      raise exception 'Chưa nhập số lượng "%".', v_cfg.name using errcode = 'P0001';
    end if;
    begin
      v_qty := (v_line ->> 'quantity')::numeric;
    exception when others then
      raise exception 'Số lượng "%" không hợp lệ.', v_cfg.name using errcode = 'P0001';
    end;
    if v_qty < 0 or v_qty > 1000000 then
      raise exception 'Số lượng "%" không hợp lệ.', v_cfg.name using errcode = 'P0001';
    end if;

    v_path := nullif(v_line ->> 'photo_path', '');
    if v_path is null and v_cfg.requires_photo then
      raise exception 'Chưa chụp ảnh "%".', v_cfg.name using errcode = 'P0001';
    end if;
    if v_path is not null and (
      split_part(v_path, '/', 1) <> p_branch_id::text
      or split_part(v_path, '/', 3) <> v_me::text
      or not exists (select 1 from storage.objects o where o.bucket_id = 'handover-photos' and o.name = v_path)
      or exists (select 1 from public.shift_handover_lines x where x.photo_path = v_path)
    ) then
      raise exception 'Ảnh "%" không hợp lệ. Vui lòng chụp lại.', v_cfg.name using errcode = 'P0001';
    end if;

    insert into public.shift_handover_lines (handover_id, handover_item_id, item_name, unit, quantity, photo_path, sort_order)
    values (v_id, v_cfg.id, v_cfg.name, v_cfg.unit, round(v_qty, 4), v_path, v_count);
    v_count := v_count + 1;
    v_line := null;
  end loop;

  update public.shift_handovers s set line_count = v_count where s.id = v_id;

  -- Báo người nhận ca: NV chi nhánh đang trong ca, hoặc có ca bắt đầu từ 1 giờ trước đến 4 giờ tới
  select b.name into v_branch from public.branches b where b.id = p_branch_id;
  insert into public.notifications (employee_id, kind, ref_id, title, body, url)
  select e.id, 'handover_new', v_id,
         '🤝 Bàn giao ca mới — ' || v_branch,
         v_name || ' đã bàn giao ' || v_count || ' món. Kiểm tra ảnh & số lượng rồi bấm xác nhận.',
         '/handover/' || v_id
  from public.employees e
  where e.is_active and e.id <> v_me and e.role <> 'admin'
    and exists (select 1 from public.employee_branches eb where eb.employee_id = e.id and eb.branch_id = p_branch_id)
    and (
      exists (
        select 1 from public.attendance_records a
        where a.employee_id = e.id and a.branch_id = p_branch_id and a.check_out_at is null
      )
      or exists (
        select 1 from public.shifts s
        where s.employee_id = e.id and s.branch_id = p_branch_id and s.status = 'published'
          and s.start_at between now() - interval '1 hour' and now() + interval '4 hours'
      )
    );
  if found then
    perform private.push_now();
  end if;

  return v_id;
end;
$$;
