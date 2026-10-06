-- =====================================================================
-- PHASE 3 — CHECKLIST CÔNG VIỆC
-- =====================================================================
-- Nghiệp vụ đã chốt:
--   * Checklist theo NGÀY. Mẫu lặp: hằng ngày / theo thứ trong tuần / theo ngày trong tháng.
--   * Mỗi mẫu: 1 người chính + (tùy chọn) 1 người thay thế, cùng chi nhánh với mẫu.
--   * Người thay thế chỉ được làm khi người chính KHÔNG chấm công ngày đó.
--   * Quản trị viên + Quản lý (chi nhánh mình) tạo/sửa mẫu. Không xóa mẫu, chỉ ngừng.
--   * Hoàn thành: ảnh / ghi chú bắt buộc tùy từng mẫu. "Không đạt" luôn cần lý do.
--   * Phải đang trong ca (tại chi nhánh của việc) mới đánh dấu được — trừ người không phải chấm công.
--   * Quản lý không duyệt, chỉ xem báo cáo; có thể mở lại việc đã đánh dấu (kèm lý do).
--   * task_instances "chụp" nội dung mẫu lúc sinh → sửa mẫu không làm sai lịch sử ngày đã qua.
-- =====================================================================

create type public.task_frequency as enum ('daily', 'weekly', 'monthly');
create type public.task_priority  as enum ('low', 'normal', 'high', 'critical');
create type public.task_status    as enum ('pending', 'done', 'failed', 'cancelled');

-- Ngày hiện tại theo giờ Việt Nam
create or replace function private.vn_today()
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date
$$;

-- ---------------------------------------------------------------------
-- 1. MẪU CÔNG VIỆC
-- ---------------------------------------------------------------------
create table public.task_templates (
  id                  uuid primary key default gen_random_uuid(),
  branch_id           uuid not null references public.branches (id),
  title               text not null,
  description         text,
  category            text not null default 'Khác',
  priority            public.task_priority not null default 'normal',
  start_time          time not null,
  due_time            time not null,
  frequency           public.task_frequency not null default 'daily',
  weekdays            smallint[] not null default '{}',   -- 1 = Thứ 2 ... 7 = Chủ nhật (ISO)
  month_days          smallint[] not null default '{}',   -- 1..31
  requires_photo      boolean not null default false,
  requires_note       boolean not null default false,
  primary_employee_id uuid not null references public.employees (id),
  backup_employee_id  uuid references public.employees (id),
  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.employees (id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.employees (id),

  constraint task_templates_title_len   check (char_length(btrim(title)) between 1 and 150),
  constraint task_templates_desc_len    check (description is null or char_length(description) <= 1000),
  constraint task_templates_category    check (char_length(btrim(category)) between 1 and 50),
  constraint task_templates_times       check (due_time > start_time),
  constraint task_templates_backup_diff check (backup_employee_id is null or backup_employee_id <> primary_employee_id),
  constraint task_templates_weekdays    check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  constraint task_templates_month_days  check (month_days <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[]),
  constraint task_templates_schedule    check (
    (frequency = 'daily')
    or (frequency = 'weekly'  and cardinality(weekdays) > 0)
    or (frequency = 'monthly' and cardinality(month_days) > 0)
  )
);

create index task_templates_branch_idx  on public.task_templates (branch_id, is_active, sort_order);
create index task_templates_primary_idx on public.task_templates (primary_employee_id);
create index task_templates_backup_idx  on public.task_templates (backup_employee_id);
create index task_templates_created_idx on public.task_templates (created_by);
create index task_templates_updated_idx on public.task_templates (updated_by);

-- ---------------------------------------------------------------------
-- 2. VIỆC THEO NGÀY
-- ---------------------------------------------------------------------
create table public.task_instances (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references public.task_templates (id),
  branch_id           uuid not null references public.branches (id),
  task_date           date not null,
  title               text not null,
  description         text,
  category            text not null,
  priority            public.task_priority not null,
  start_at            timestamptz not null,
  due_at              timestamptz not null,
  requires_photo      boolean not null,
  requires_note       boolean not null,
  primary_employee_id uuid not null references public.employees (id),
  backup_employee_id  uuid references public.employees (id),
  status              public.task_status not null default 'pending',
  completed_by        uuid references public.employees (id),
  completed_at        timestamptz,
  note                text,
  photo_path          text,
  reopened_by         uuid references public.employees (id),
  reopened_at         timestamptz,
  reopen_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint task_instances_unique_day unique (template_id, task_date),
  constraint task_instances_completion check (
    (status in ('done', 'failed')) = (completed_by is not null and completed_at is not null)
  ),
  constraint task_instances_note_len check (note is null or char_length(note) <= 1000)
);

create index task_instances_branch_day_idx  on public.task_instances (branch_id, task_date);
create index task_instances_primary_day_idx on public.task_instances (primary_employee_id, task_date);
create index task_instances_backup_day_idx  on public.task_instances (backup_employee_id, task_date);
create index task_instances_completed_idx   on public.task_instances (completed_by);
create index task_instances_reopened_idx    on public.task_instances (reopened_by);

-- ---------------------------------------------------------------------
-- 3. LỊCH LẶP
-- ---------------------------------------------------------------------
create or replace function private.task_scheduled_on(p_t public.task_templates, p_date date)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case p_t.frequency
    when 'daily' then true
    when 'weekly' then extract(isodow from p_date)::smallint = any (p_t.weekdays)
    when 'monthly' then
      extract(day from p_date)::smallint = any (p_t.month_days)
      -- Ngày 29/30/31 không tồn tại trong tháng → chạy vào ngày cuối tháng
      or (
        p_date = (date_trunc('month', p_date) + interval '1 month - 1 day')::date
        and exists (select 1 from unnest(p_t.month_days) d where d > extract(day from p_date))
      )
  end
$$;

-- ---------------------------------------------------------------------
-- 4. TRIGGER MẪU CÔNG VIỆC
-- ---------------------------------------------------------------------
create or replace function private.task_templates_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.title       := btrim(new.title);
  new.description := nullif(btrim(new.description), '');
  new.category    := btrim(new.category);

  -- Chuẩn hóa lịch lặp
  if new.frequency = 'daily' then
    new.weekdays := '{}';
    new.month_days := '{}';
  elsif new.frequency = 'weekly' then
    new.month_days := '{}';
    select coalesce(array_agg(distinct d order by d), '{}') into new.weekdays from unnest(new.weekdays) d;
  else
    new.weekdays := '{}';
    select coalesce(array_agg(distinct d order by d), '{}') into new.month_days from unnest(new.month_days) d;
  end if;

  -- Người thực hiện phải đang hoạt động và thuộc chi nhánh của mẫu
  if not exists (
    select 1 from public.employees e
    join public.employee_branches eb on eb.employee_id = e.id and eb.branch_id = new.branch_id
    where e.id = new.primary_employee_id and e.is_active
  ) then
    raise exception 'Người phụ trách chính phải là nhân viên đang làm tại chi nhánh này.' using errcode = 'P0001';
  end if;
  if new.backup_employee_id is not null and not exists (
    select 1 from public.employees e
    join public.employee_branches eb on eb.employee_id = e.id and eb.branch_id = new.branch_id
    where e.id = new.backup_employee_id and e.is_active
  ) then
    raise exception 'Người thay thế phải là nhân viên đang làm tại chi nhánh này.' using errcode = 'P0001';
  end if;

  new.updated_at := now();
  new.updated_by := private.current_employee_id();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := private.current_employee_id();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if new.branch_id <> old.branch_id then
      raise exception 'Không được chuyển mẫu công việc sang chi nhánh khác. Hãy tạo mẫu mới.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger task_templates_guard
before insert or update on public.task_templates
for each row execute function private.task_templates_guard();

-- Đồng bộ thay đổi của mẫu sang các việc CHƯA làm từ hôm nay trở đi
create or replace function private.task_templates_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not new.is_active then
    update public.task_instances i
    set status = 'cancelled', updated_at = now()
    where i.template_id = new.id and i.status = 'pending' and i.task_date >= private.vn_today();
    return new;
  end if;

  update public.task_instances i set
    title               = new.title,
    description         = new.description,
    category            = new.category,
    priority            = new.priority,
    start_at            = (i.task_date + new.start_time) at time zone 'Asia/Ho_Chi_Minh',
    due_at              = (i.task_date + new.due_time) at time zone 'Asia/Ho_Chi_Minh',
    requires_photo      = new.requires_photo,
    requires_note       = new.requires_note,
    primary_employee_id = new.primary_employee_id,
    backup_employee_id  = new.backup_employee_id,
    status              = case when private.task_scheduled_on(new, i.task_date) then 'pending'::public.task_status else 'cancelled'::public.task_status end,
    updated_at          = now()
  where i.template_id = new.id
    and i.status in ('pending', 'cancelled')
    and i.task_date >= private.vn_today();
  return new;
end;
$$;

create trigger task_templates_sync
after update on public.task_templates
for each row execute function private.task_templates_sync();

create trigger task_templates_forbid_delete
before delete on public.task_templates
for each row execute function private.forbid_delete();

create trigger task_templates_audit
after insert or update on public.task_templates
for each row execute function private.write_audit_log();

create trigger task_instances_forbid_delete
before delete on public.task_instances
for each row execute function private.forbid_delete();

-- Chỉ ghi log khi đánh dấu / mở lại (không ghi khi đồng bộ hàng loạt từ mẫu)
create or replace function private.task_instances_audit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and (new.status in ('done', 'failed') or old.status in ('done', 'failed')) then
    insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, old_data, new_data)
    values ('task_instances', new.id, 'UPDATE', (select auth.uid()), private.current_employee_id(), to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;

create trigger task_instances_audit
after update on public.task_instances
for each row execute function private.task_instances_audit();

-- ---------------------------------------------------------------------
-- 5. SINH VIỆC THEO NGÀY (idempotent — gọi nhiều lần không tạo trùng)
-- ---------------------------------------------------------------------
create or replace function public.ensure_task_instances(p_date date default null)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_date  date := coalesce(p_date, private.vn_today());
  v_count integer;
begin
  if private.current_employee_id() is null and (select auth.uid()) is not null then
    raise exception 'Tài khoản không hợp lệ.' using errcode = '42501';
  end if;
  if v_date < private.vn_today() - 1 or v_date > private.vn_today() + 1 then
    raise exception 'Chỉ sinh việc cho hôm qua, hôm nay hoặc ngày mai.' using errcode = 'P0001';
  end if;

  insert into public.task_instances (
    template_id, branch_id, task_date, title, description, category, priority,
    start_at, due_at, requires_photo, requires_note, primary_employee_id, backup_employee_id
  )
  select
    t.id, t.branch_id, v_date, t.title, t.description, t.category, t.priority,
    (v_date + t.start_time) at time zone 'Asia/Ho_Chi_Minh',
    (v_date + t.due_time) at time zone 'Asia/Ho_Chi_Minh',
    t.requires_photo, t.requires_note, t.primary_employee_id, t.backup_employee_id
  from public.task_templates t
  join public.branches b on b.id = t.branch_id and b.is_active
  where t.is_active and private.task_scheduled_on(t, v_date)
  on conflict (template_id, task_date) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Người chính đã chấm công vào ngày đó chưa
create or replace function private.checked_in_on(p_employee_id uuid, p_date date)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attendance_records a
    where a.employee_id = p_employee_id
      and a.check_in_at >= (p_date::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and a.check_in_at <  ((p_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
  )
$$;

-- ---------------------------------------------------------------------
-- 6. ĐÁNH DẤU HOÀN THÀNH / KHÔNG ĐẠT (CHỈ SERVER GỌI — service_role)
-- ---------------------------------------------------------------------
-- Server đã xác thực phiên và tự tải ảnh lên kho riêng tư, rồi mới gọi hàm này,
-- nên người dùng không thể tự khai "đã có ảnh" mà không tải ảnh thật.
create or replace function public.complete_task_instance(
  p_auth_uid uuid,
  p_instance_id uuid,
  p_status public.task_status,
  p_note text default null,
  p_photo_path text default null
)
returns public.task_instances
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_emp    public.employees;
  v_inst   public.task_instances;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_branch text;
  v_result public.task_instances;
begin
  perform private.act_as(p_auth_uid);

  select * into v_emp from public.employees e where e.auth_user_id = p_auth_uid and e.is_active;
  if v_emp.id is null then
    raise exception 'Tài khoản không hợp lệ hoặc đã bị khóa.' using errcode = '42501';
  end if;

  select * into v_inst from public.task_instances i where i.id = p_instance_id for update;
  if v_inst.id is null then
    raise exception 'Không tìm thấy công việc.' using errcode = 'P0001';
  end if;
  if p_status not in ('done', 'failed') then
    raise exception 'Trạng thái không hợp lệ.' using errcode = 'P0001';
  end if;
  if v_inst.status <> 'pending' then
    raise exception 'Việc này đã được đánh dấu trước đó.' using errcode = 'P0001';
  end if;
  if v_inst.task_date <> private.vn_today() then
    raise exception 'Chỉ đánh dấu được công việc của hôm nay.' using errcode = 'P0001';
  end if;

  -- Ai được làm
  if v_emp.id = v_inst.primary_employee_id then
    null;
  elsif v_emp.id = v_inst.backup_employee_id then
    if private.checked_in_on(v_inst.primary_employee_id, v_inst.task_date) then
      raise exception 'Người phụ trách chính đã đi làm hôm nay nên việc này do họ thực hiện.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Việc này không được giao cho bạn.' using errcode = '42501';
  end if;

  -- Phải đang trong ca tại chi nhánh của việc (trừ người không phải chấm công)
  if v_emp.role <> 'admin' and v_emp.requires_attendance and not exists (
    select 1 from public.attendance_records a
    where a.employee_id = v_emp.id and a.check_out_at is null and a.branch_id = v_inst.branch_id
  ) then
    select b.name into v_branch from public.branches b where b.id = v_inst.branch_id;
    raise exception 'Bạn cần vào ca tại % trước khi đánh dấu công việc.', v_branch using errcode = 'P0001';
  end if;

  -- Bằng chứng
  if p_status = 'failed' and char_length(coalesce(v_note, '')) < 3 then
    raise exception 'Vui lòng ghi lý do không hoàn thành được.' using errcode = 'P0001';
  end if;
  if p_status = 'done' and v_inst.requires_note and v_note is null then
    raise exception 'Việc này bắt buộc ghi chú.' using errcode = 'P0001';
  end if;
  if p_status = 'done' and v_inst.requires_photo and p_photo_path is null then
    raise exception 'Việc này bắt buộc chụp ảnh.' using errcode = 'P0001';
  end if;

  update public.task_instances i set
    status       = p_status,
    completed_by = v_emp.id,
    completed_at = now(),
    note         = v_note,
    photo_path   = p_photo_path,
    updated_at   = now()
  where i.id = v_inst.id and i.status = 'pending'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Việc này đã được đánh dấu trước đó.' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. QUẢN LÝ MỞ LẠI VIỆC ĐÃ ĐÁNH DẤU (kèm lý do)
-- ---------------------------------------------------------------------
create or replace function public.reopen_task_instance(p_instance_id uuid, p_reason text)
returns public.task_instances
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_inst   public.task_instances;
  v_result public.task_instances;
begin
  select * into v_inst from public.task_instances i where i.id = p_instance_id for update;
  if v_inst.id is null or not private.manages_branch(v_inst.branch_id) then
    raise exception 'Không tìm thấy công việc hoặc bạn không có quyền.' using errcode = '42501';
  end if;
  if v_inst.status not in ('done', 'failed') then
    raise exception 'Chỉ mở lại được việc đã đánh dấu.' using errcode = 'P0001';
  end if;
  if v_inst.task_date <> private.vn_today() then
    raise exception 'Chỉ mở lại được công việc của hôm nay.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Vui lòng nhập lý do mở lại.' using errcode = 'P0001';
  end if;

  update public.task_instances i set
    status        = 'pending',
    completed_by  = null,
    completed_at  = null,
    note          = null,
    photo_path    = null,
    reopened_by   = private.current_employee_id(),
    reopened_at   = now(),
    reopen_reason = btrim(p_reason),
    updated_at    = now()
  where i.id = v_inst.id
  returning * into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. KHO ẢNH (riêng tư — chỉ server đọc/ghi bằng secret key, cấp link ký tạm thời)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-photos', 'task-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 9. QUYỀN THỰC THI HÀM
-- ---------------------------------------------------------------------
revoke all on function public.complete_task_instance(uuid, uuid, public.task_status, text, text) from public, anon, authenticated;
grant execute on function public.complete_task_instance(uuid, uuid, public.task_status, text, text) to service_role;

revoke all on function public.ensure_task_instances(date) from public, anon;
grant execute on function public.ensure_task_instances(date) to authenticated, service_role;

revoke all on function public.reopen_task_instance(uuid, text) from public, anon;
grant execute on function public.reopen_task_instance(uuid, text) to authenticated;

revoke all on function private.task_scheduled_on(public.task_templates, date) from public;
revoke all on function private.checked_in_on(uuid, date) from public;

-- ---------------------------------------------------------------------
-- 10. RLS
-- ---------------------------------------------------------------------
alter table public.task_templates enable row level security;
alter table public.task_instances enable row level security;

revoke all on public.task_templates from anon;
revoke all on public.task_instances from anon;
revoke delete, truncate on public.task_templates from authenticated;
revoke insert, update, delete, truncate on public.task_instances from authenticated;

create policy "task_templates_select"
on public.task_templates for select
to authenticated
using (
  (select private.manages_branch(branch_id))
  or primary_employee_id = (select private.current_employee_id())
  or backup_employee_id  = (select private.current_employee_id())
);

create policy "task_templates_insert_scope"
on public.task_templates for insert
to authenticated
with check ((select private.manages_branch(branch_id)));

create policy "task_templates_update_scope"
on public.task_templates for update
to authenticated
using ((select private.manages_branch(branch_id)))
with check ((select private.manages_branch(branch_id)));

create policy "task_instances_select"
on public.task_instances for select
to authenticated
using (
  (select private.manages_branch(branch_id))
  or primary_employee_id = (select private.current_employee_id())
  or backup_employee_id  = (select private.current_employee_id())
);
