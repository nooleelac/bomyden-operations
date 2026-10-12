-- =====================================================================
-- BÀN GIAO CA: PHÂN QUYỀN NHÂN VIÊN (13/10/2026)
-- =====================================================================
-- Nghiệp vụ đã chốt:
--   * Mặc định KHÔNG ai được bàn giao / nhận. QTV + QL chi nhánh cài cho từng nhân viên.
--   * Bàn giao: QL giao MÓN CỤ THỂ cho từng NV (handover_item_staff). Ai có ≥ 1 món mới bàn giao được;
--     phiếu của NV gồm đủ các món được giao cho NV đó (không hơn, không thiếu).
--   * Nhận: người được bật "Nhận bàn giao" (handover_receivers) HOẶC người cũng phụ trách
--     một món có trong phiếu. Người giao không tự nhận.
--   * NV phải thuộc chi nhánh (employee_branches) mới được cài.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BẢNG
-- ---------------------------------------------------------------------
create table public.handover_item_staff (
  handover_item_id uuid not null references public.handover_items (id) on delete cascade,
  employee_id      uuid not null references public.employees (id),
  created_at       timestamptz not null default now(),
  created_by       uuid references public.employees (id),
  primary key (handover_item_id, employee_id)
);
create index handover_item_staff_employee_idx on public.handover_item_staff (employee_id);
create index handover_item_staff_created_idx on public.handover_item_staff (created_by);

create table public.handover_receivers (
  branch_id   uuid not null references public.branches (id),
  employee_id uuid not null references public.employees (id),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.employees (id),
  primary key (branch_id, employee_id)
);
create index handover_receivers_employee_idx on public.handover_receivers (employee_id);
create index handover_receivers_created_idx on public.handover_receivers (created_by);

-- NV phải thuộc chi nhánh; ghi người cài
create or replace function private.handover_staff_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_branch uuid;
begin
  if tg_table_name = 'handover_item_staff' then
    select h.branch_id into v_branch from public.handover_items h where h.id = new.handover_item_id;
  else
    v_branch := new.branch_id;
  end if;
  if not exists (
    select 1 from public.employee_branches eb
    join public.employees e on e.id = eb.employee_id and e.is_active
    where eb.employee_id = new.employee_id and eb.branch_id = v_branch
  ) then
    raise exception 'Nhân viên không thuộc chi nhánh này.' using errcode = 'P0001';
  end if;
  new.created_by := private.current_employee_id();
  new.created_at := now();
  return new;
end;
$$;
revoke all on function private.handover_staff_guard() from public;

create trigger handover_item_staff_guard before insert on public.handover_item_staff
for each row execute function private.handover_staff_guard();
create trigger handover_receivers_guard before insert on public.handover_receivers
for each row execute function private.handover_staff_guard();
create trigger handover_item_staff_audit after insert or delete on public.handover_item_staff
for each row execute function private.write_audit_log();
create trigger handover_receivers_audit after insert or delete on public.handover_receivers
for each row execute function private.write_audit_log();

-- Chi nhánh của một món (dùng trong RLS)
create or replace function private.handover_item_branch(p_item_id uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select h.branch_id from public.handover_items h where h.id = p_item_id
$$;
revoke all on function private.handover_item_branch(uuid) from public;
grant execute on function private.handover_item_branch(uuid) to authenticated, service_role;

-- Người này có được nhận phiếu này không
create or replace function private.can_receive_handover(p_handover_id uuid, p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shift_handovers s
    where s.id = p_handover_id and s.handed_by <> p_employee_id
      and (
        exists (select 1 from public.handover_receivers r where r.branch_id = s.branch_id and r.employee_id = p_employee_id)
        or exists (
          select 1 from public.shift_handover_lines l
          join public.handover_item_staff st on st.handover_item_id = l.handover_item_id
          where l.handover_id = s.id and st.employee_id = p_employee_id
        )
      )
  )
$$;
revoke all on function private.can_receive_handover(uuid, uuid) from public;
grant execute on function private.can_receive_handover(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. TẠO PHIẾU: chỉ món được giao cho mình, phải đủ
-- ---------------------------------------------------------------------
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
  if not exists (
    select 1 from public.handover_item_staff st
    join public.handover_items h on h.id = st.handover_item_id
    where h.branch_id = p_branch_id and st.employee_id = v_me
  ) then
    raise exception 'Bạn chưa được giao món nào để bàn giao ở chi nhánh này. Nhờ Quản lý cài đặt.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'Dữ liệu bàn giao không hợp lệ.' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Ghi chú quá dài (tối đa 1000 ký tự).' using errcode = 'P0001';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (select count(distinct l ->> 'handover_item_id') from jsonb_array_elements(p_lines) l) then
    raise exception 'Có món bị nhập trùng.' using errcode = 'P0001';
  end if;
  if (select count(l ->> 'photo_path') from jsonb_array_elements(p_lines) l where nullif(l ->> 'photo_path', '') is not null)
     <> (select count(distinct l ->> 'photo_path') from jsonb_array_elements(p_lines) l where nullif(l ->> 'photo_path', '') is not null) then
    raise exception 'Mỗi món cần một ảnh riêng.' using errcode = 'P0001';
  end if;
  -- Món không được giao cho mình (hoặc danh sách vừa đổi)
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where not exists (
      select 1 from public.handover_items h
      join public.handover_item_staff st on st.handover_item_id = h.id and st.employee_id = v_me
      where h.branch_id = p_branch_id and h.id::text = l ->> 'handover_item_id'
    )
  ) then
    raise exception 'Món bàn giao của bạn vừa thay đổi. Tải lại trang rồi nhập lại.' using errcode = 'P0001';
  end if;

  select e.full_name into v_name from public.employees e where e.id = v_me;
  insert into public.shift_handovers (branch_id, handed_by, handed_by_name, note)
  values (p_branch_id, v_me, v_name, v_note)
  returning id into v_id;

  for v_cfg in
    select h.id, h.name, h.unit, h.requires_photo
    from public.handover_items h
    join public.handover_item_staff st on st.handover_item_id = h.id and st.employee_id = v_me
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

  -- Báo người được nhận phiếu này đang trong ca, hoặc có ca bắt đầu từ 1 giờ trước đến 4 giờ tới
  select b.name into v_branch from public.branches b where b.id = p_branch_id;
  insert into public.notifications (employee_id, kind, ref_id, title, body, url)
  select e.id, 'handover_new', v_id,
         '🤝 Bàn giao ca mới — ' || v_branch,
         v_name || ' đã bàn giao ' || v_count || ' món. Kiểm tra ảnh & số lượng rồi bấm xác nhận.',
         '/handover/' || v_id
  from public.employees e
  where e.is_active and e.id <> v_me
    and private.can_receive_handover(v_id, e.id)
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

-- ---------------------------------------------------------------------
-- 3. NHẬN CA: chỉ người có quyền nhận / cùng phụ trách món trong phiếu
-- ---------------------------------------------------------------------
create or replace function public.receive_shift_handover(p_handover_id uuid, p_ok boolean, p_note text default null)
returns public.shift_handovers
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_employee_id();
  v_h      public.shift_handovers;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_name   text;
  v_branch text;
  v_result public.shift_handovers;
begin
  if v_me is null then
    raise exception 'Tài khoản không hợp lệ.' using errcode = '42501';
  end if;
  select * into v_h from public.shift_handovers s where s.id = p_handover_id for update;
  if v_h.id is null or not (private.in_my_branch(v_h.branch_id) or private.manages_branch(v_h.branch_id)) then
    raise exception 'Không tìm thấy phiếu bàn giao hoặc bạn không có quyền.' using errcode = '42501';
  end if;
  if v_h.handed_by = v_me then
    raise exception 'Người giao ca không tự xác nhận được — cần người nhận ca xác nhận.' using errcode = 'P0001';
  end if;
  if not private.can_receive_handover(v_h.id, v_me) then
    raise exception 'Bạn không có quyền nhận phiếu bàn giao này. Nhờ Quản lý cài đặt.' using errcode = '42501';
  end if;
  if v_h.status <> 'pending' then
    raise exception 'Phiếu này đã được xác nhận trước đó.' using errcode = 'P0001';
  end if;
  if not coalesce(p_ok, false) and char_length(coalesce(v_note, '')) < 3 then
    raise exception 'Vui lòng ghi rõ sai lệch (món nào, thực tế bao nhiêu).' using errcode = 'P0001';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Ghi chú quá dài (tối đa 1000 ký tự).' using errcode = 'P0001';
  end if;

  update public.shift_handovers s set
    status       = case when p_ok then 'confirmed'::public.handover_status else 'disputed'::public.handover_status end,
    received_by  = v_me,
    received_by_name = (select e.full_name from public.employees e where e.id = v_me),
    received_at  = now(),
    receive_note = v_note,
    updated_at   = now()
  where s.id = v_h.id
  returning * into v_result;

  -- Phiếu đã có người nhận → thông báo "bàn giao mới" của mọi người coi như đã đọc
  update public.notifications n set read_at = now()
  where n.kind = 'handover_new' and n.ref_id = v_h.id and n.read_at is null;

  if not p_ok then
    v_name := v_result.received_by_name;
    select b.name into v_branch from public.branches b where b.id = v_h.branch_id;
    insert into public.notifications (employee_id, kind, ref_id, title, body, url)
    select m.id, 'handover_disputed', v_h.id,
           '⚠️ Bàn giao ca có sai lệch — ' || v_branch,
           v_name || ': ' || left(v_note, 140),
           '/handover/' || v_h.id
    from public.employees m
    where m.is_active and m.id <> v_me and (
      m.id = v_h.handed_by
      or m.role = 'admin'
      or (m.role = 'manager' and exists (
        select 1 from public.employee_branches eb where eb.employee_id = m.id and eb.branch_id = v_h.branch_id
      ))
    );
    perform private.push_now();
  end if;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. QUYỀN & RLS
-- ---------------------------------------------------------------------
alter table public.handover_item_staff enable row level security;
alter table public.handover_receivers enable row level security;
revoke all on public.handover_item_staff, public.handover_receivers from anon;
revoke update, truncate on public.handover_item_staff, public.handover_receivers from authenticated;

-- NV chi nhánh xem (để biết mình được giao món nào / nhận được phiếu nào); QTV / QL chi nhánh cài
create policy "handover_item_staff_select" on public.handover_item_staff for select to authenticated
using (
  (select private.in_my_branch(private.handover_item_branch(handover_item_id)))
  or (select private.manages_branch(private.handover_item_branch(handover_item_id)))
);
create policy "handover_item_staff_insert" on public.handover_item_staff for insert to authenticated
with check ((select private.manages_branch(private.handover_item_branch(handover_item_id))));
create policy "handover_item_staff_delete" on public.handover_item_staff for delete to authenticated
using ((select private.manages_branch(private.handover_item_branch(handover_item_id))));

create policy "handover_receivers_select" on public.handover_receivers for select to authenticated
using ((select private.in_my_branch(branch_id)) or (select private.manages_branch(branch_id)));
create policy "handover_receivers_insert" on public.handover_receivers for insert to authenticated
with check ((select private.manages_branch(branch_id)));
create policy "handover_receivers_delete" on public.handover_receivers for delete to authenticated
using ((select private.manages_branch(branch_id)));

alter publication supabase_realtime add table public.handover_item_staff, public.handover_receivers;
