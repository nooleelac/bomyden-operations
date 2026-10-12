-- =====================================================================
-- BÀN GIAO CA: CHỤP ẢNH + GHI SỐ KG / SỐ LƯỢNG THỊT BÒ & NGUYÊN LIỆU (13/10/2026)
-- =====================================================================
-- Nghiệp vụ đã chốt:
--   * QTV/QL chọn sẵn danh sách món phải bàn giao cho từng chi nhánh (lấy từ danh mục kho),
--     kèm đơn vị ghi (kg, khay…) và có bắt buộc ảnh hay không.
--   * Mọi nhân viên của chi nhánh tạo được phiếu: nhập số lượng + chụp ảnh TỪNG món (đủ cả danh sách).
--   * Người nhận ca (nhân viên khác cùng chi nhánh) bấm "Đã nhận" hoặc "Báo sai lệch" (ghi rõ).
--     Sai lệch → báo đẩy cho Quản lý chi nhánh + QTV + người giao.
--   * Phiếu bàn giao KHÔNG thay đổi tồn kho (chỉ ghi nhận).
--   * Ảnh lưu kho riêng "handover-photos", giữ 3 tháng như ảnh checklist; ảnh tải lên nhưng không
--     gửi phiếu (bỏ dở) xóa sau 1 ngày.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DANH SÁCH MÓN PHẢI BÀN GIAO (theo chi nhánh)
-- ---------------------------------------------------------------------
create table public.handover_items (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches (id),
  item_id        uuid not null references public.inventory_items (id),
  -- đơn vị ghi khi bàn giao: đơn vị gốc của nguyên liệu hoặc một đơn vị quy đổi
  unit           text not null,
  requires_photo boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.employees (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.employees (id),
  constraint handover_items_unique unique (branch_id, item_id),
  constraint handover_items_unit_len check (char_length(btrim(unit)) between 1 and 20)
);
create index handover_items_item_idx on public.handover_items (item_id);
create index handover_items_created_idx on public.handover_items (created_by);
create index handover_items_updated_idx on public.handover_items (updated_by);

-- Đơn vị phải là đơn vị gốc hoặc đơn vị quy đổi của nguyên liệu; tự ghi người sửa
create or replace function private.handover_items_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.unit := btrim(new.unit);
  if not exists (select 1 from public.inventory_items i where i.id = new.item_id and i.base_unit = new.unit)
     and not exists (select 1 from public.inventory_item_units u where u.item_id = new.item_id and u.unit_name = new.unit) then
    raise exception 'Đơn vị "%" không thuộc nguyên liệu này.', new.unit using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, private.current_employee_id());
  else
    new.branch_id := old.branch_id;
    new.item_id := old.item_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := private.current_employee_id();
  return new;
end;
$$;
revoke all on function private.handover_items_guard() from public;

create trigger handover_items_guard before insert or update on public.handover_items
for each row execute function private.handover_items_guard();
create trigger handover_items_audit after insert or update or delete on public.handover_items
for each row execute function private.write_audit_log();

-- ---------------------------------------------------------------------
-- 2. PHIẾU BÀN GIAO + DÒNG
-- ---------------------------------------------------------------------
create type public.handover_status as enum ('pending', 'confirmed', 'disputed');

create table public.shift_handovers (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches (id),
  handed_by    uuid not null references public.employees (id),
  -- tên lưu kèm: nhân viên thường không đọc được hồ sơ đồng nghiệp (RLS employees)
  handed_by_name   text not null,
  note         text,
  line_count   integer not null default 0,
  status       public.handover_status not null default 'pending',
  received_by  uuid references public.employees (id),
  received_by_name text,
  received_at  timestamptz,
  receive_note text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint shift_handovers_note_len check (note is null or char_length(note) <= 1000),
  constraint shift_handovers_receive_note_len check (receive_note is null or char_length(receive_note) <= 1000),
  constraint shift_handovers_received check ((status = 'pending') = (received_at is null))
);
create index shift_handovers_branch_idx on public.shift_handovers (branch_id, created_at desc);
create index shift_handovers_handed_idx on public.shift_handovers (handed_by);
create index shift_handovers_received_idx on public.shift_handovers (received_by);
create index shift_handovers_pending_idx on public.shift_handovers (branch_id) where status = 'pending';

create table public.shift_handover_lines (
  id              uuid primary key default gen_random_uuid(),
  handover_id     uuid not null references public.shift_handovers (id),
  item_id         uuid not null references public.inventory_items (id),
  -- tên & đơn vị lúc bàn giao (giữ nguyên dù danh mục đổi sau này)
  item_name       text not null,
  unit            text not null,
  quantity        numeric(16, 4) not null,
  photo_path      text,
  photo_purged_at timestamptz,
  sort_order      integer not null default 0,
  constraint shift_handover_lines_unique unique (handover_id, item_id),
  constraint shift_handover_lines_qty check (quantity >= 0)
);
create index shift_handover_lines_item_idx on public.shift_handover_lines (item_id);
create index shift_handover_lines_photo_idx on public.shift_handover_lines (photo_path) where photo_path is not null;

create trigger shift_handovers_forbid_delete before delete on public.shift_handovers
for each row execute function private.forbid_delete();
create trigger shift_handover_lines_forbid_delete before delete on public.shift_handover_lines
for each row execute function private.forbid_delete();

-- ---------------------------------------------------------------------
-- 3. TẠO PHIẾU (nhân viên chi nhánh)
-- ---------------------------------------------------------------------
-- p_lines: [{ "item_id": uuid, "quantity": number, "photo_path": text|null }, ...]
-- Ảnh đã được server tải lên kho "handover-photos" theo đường dẫn <chi nhánh>/<ngày>/<nhân viên>/<uuid>.jpg
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
    raise exception 'Chi nhánh chưa có danh sách món bàn giao. Nhờ Quản lý thiết lập trước.' using errcode = 'P0001';
  end if;
  -- Mỗi món chỉ một dòng, ảnh không dùng lại
  if (select count(*) from jsonb_array_elements(p_lines)) <> (select count(distinct l ->> 'item_id') from jsonb_array_elements(p_lines) l) then
    raise exception 'Có món bị nhập trùng.' using errcode = 'P0001';
  end if;
  if (select count(l ->> 'photo_path') from jsonb_array_elements(p_lines) l where nullif(l ->> 'photo_path', '') is not null)
     <> (select count(distinct l ->> 'photo_path') from jsonb_array_elements(p_lines) l where nullif(l ->> 'photo_path', '') is not null) then
    raise exception 'Mỗi món cần một ảnh riêng.' using errcode = 'P0001';
  end if;
  -- Món không có trong danh sách
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where not exists (
      select 1 from public.handover_items h where h.branch_id = p_branch_id and h.item_id::text = l ->> 'item_id'
    )
  ) then
    raise exception 'Danh sách món bàn giao vừa thay đổi. Tải lại trang rồi nhập lại.' using errcode = 'P0001';
  end if;

  select e.full_name into v_name from public.employees e where e.id = v_me;
  insert into public.shift_handovers (branch_id, handed_by, handed_by_name, note)
  values (p_branch_id, v_me, v_name, v_note)
  returning id into v_id;

  for v_cfg in
    select h.item_id, h.unit, h.requires_photo, h.sort_order, i.name
    from public.handover_items h
    join public.inventory_items i on i.id = h.item_id
    where h.branch_id = p_branch_id
    order by h.sort_order, i.name
  loop
    select l into v_line from jsonb_array_elements(p_lines) l where l ->> 'item_id' = v_cfg.item_id::text;
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

    insert into public.shift_handover_lines (handover_id, item_id, item_name, unit, quantity, photo_path, sort_order)
    values (v_id, v_cfg.item_id, v_cfg.name, v_cfg.unit, round(v_qty, 4), v_path, v_count);
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

-- ---------------------------------------------------------------------
-- 4. NHẬN CA: xác nhận / báo sai lệch
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
-- 5. KHO ẢNH + TỰ DỌN
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('handover-photos', 'handover-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Ảnh phiếu cũ hơn 3 tháng (giữ dòng lịch sử)
create or replace function public.service_handover_photos_to_purge(p_limit integer default 500)
returns table (id uuid, photo_path text)
language sql stable security definer
set search_path = ''
as $$
  select l.id, l.photo_path
  from public.shift_handover_lines l
  join public.shift_handovers h on h.id = l.handover_id
  where l.photo_path is not null and l.photo_purged_at is null
    and h.created_at < now() - interval '3 months'
  order by h.created_at
  limit least(greatest(p_limit, 1), 1000)
$$;

create or replace function public.service_mark_handover_photos_purged(p_ids uuid[])
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.shift_handover_lines l set photo_purged_at = now() where l.id = any (p_ids) and l.photo_purged_at is null
$$;

-- Ảnh đã tải lên nhưng không thuộc phiếu nào (bỏ dở) quá 1 ngày
create or replace function public.service_handover_orphan_photos(p_limit integer default 500)
returns table (name text)
language sql stable security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'handover-photos'
    and o.created_at < now() - interval '1 day'
    and not exists (select 1 from public.shift_handover_lines l where l.photo_path = o.name)
  order by o.created_at
  limit least(greatest(p_limit, 1), 1000)
$$;

create or replace function private.run_daily_cleanup()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  -- Thông báo trên app giữ 60 ngày
  delete from public.notifications n where n.created_at < now() - interval '60 days';

  -- Nhật ký thao tác giữ 12 tháng
  perform set_config('app.audit_purge', 'on', true);
  delete from public.audit_logs a where a.created_at < now() - interval '12 months';
  perform set_config('app.audit_purge', 'off', true);

  if exists (
    select 1 from public.task_instances t
    where t.photo_path is not null and t.photo_purged_at is null
      and coalesce(t.completed_at, t.created_at) < now() - interval '3 months'
  ) or exists (
    select 1 from public.invoice_scans s
    where s.photo_purged_at is null
      and ((s.receipt_id is null and s.created_at < now() - interval '1 day') or s.created_at < now() - interval '12 months')
  ) or exists (select 1 from public.service_handover_photos_to_purge(1))
    or exists (select 1 from public.service_handover_orphan_photos(1)) then
    perform private.call_ops_job('cleanup');
  end if;
end;
$$;
revoke all on function private.run_daily_cleanup() from public;

-- ---------------------------------------------------------------------
-- 6. QUYỀN & RLS
-- ---------------------------------------------------------------------
revoke all on function public.create_shift_handover(uuid, text, jsonb) from public, anon;
revoke all on function public.receive_shift_handover(uuid, boolean, text) from public, anon;
grant execute on function public.create_shift_handover(uuid, text, jsonb) to authenticated;
grant execute on function public.receive_shift_handover(uuid, boolean, text) to authenticated;

revoke all on function public.service_handover_photos_to_purge(integer) from public, anon, authenticated;
revoke all on function public.service_mark_handover_photos_purged(uuid[]) from public, anon, authenticated;
revoke all on function public.service_handover_orphan_photos(integer) from public, anon, authenticated;
grant execute on function public.service_handover_photos_to_purge(integer) to service_role;
grant execute on function public.service_mark_handover_photos_purged(uuid[]) to service_role;
grant execute on function public.service_handover_orphan_photos(integer) to service_role;

alter table public.handover_items enable row level security;
alter table public.shift_handovers enable row level security;
alter table public.shift_handover_lines enable row level security;
revoke all on public.handover_items, public.shift_handovers, public.shift_handover_lines from anon;
revoke insert, update, delete, truncate on public.shift_handovers, public.shift_handover_lines from authenticated;
revoke truncate on public.handover_items from authenticated;

-- Danh sách món: NV chi nhánh xem; QTV/QL chi nhánh sửa
create policy "handover_items_select" on public.handover_items for select to authenticated
using ((select private.in_my_branch(branch_id)) or (select private.manages_branch(branch_id)));
create policy "handover_items_insert" on public.handover_items for insert to authenticated
with check ((select private.manages_branch(branch_id)));
create policy "handover_items_update" on public.handover_items for update to authenticated
using ((select private.manages_branch(branch_id))) with check ((select private.manages_branch(branch_id)));
create policy "handover_items_delete" on public.handover_items for delete to authenticated
using ((select private.manages_branch(branch_id)));

create policy "shift_handovers_select" on public.shift_handovers for select to authenticated
using ((select private.in_my_branch(branch_id)) or (select private.manages_branch(branch_id)));
create policy "shift_handover_lines_select" on public.shift_handover_lines for select to authenticated
using (exists (select 1 from public.shift_handovers h where h.id = handover_id));

-- NV không có quyền kho vẫn cần đọc tên nguyên liệu nằm trong danh sách bàn giao của chi nhánh mình
create policy "inventory_items_select_handover" on public.inventory_items for select to authenticated
using (exists (
  select 1 from public.handover_items h
  where h.item_id = inventory_items.id and private.in_my_branch(h.branch_id)
));

-- ---------------------------------------------------------------------
-- 7. REALTIME
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.handover_items, public.shift_handovers, public.shift_handover_lines;
