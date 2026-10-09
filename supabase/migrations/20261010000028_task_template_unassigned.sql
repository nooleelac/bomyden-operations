-- =====================================================================
-- MẪU CÔNG VIỆC CHƯA GIAO + GIAO VIỆC HÀNG LOẠT (10/10/2026)
-- =====================================================================
--   * Mẫu được phép tạo khi CHƯA có người phụ trách chính (tạo hàng loạt trước, giao sau).
--   * Mẫu chưa giao KHÔNG sinh việc theo ngày; bỏ giao → hủy các việc chưa làm từ hôm nay.
--   * Chưa có người chính thì cũng không có người thay thế.
--   * Người thay thế trùng người chính (khi giao hàng loạt giữ nguyên người thay) → tự bỏ người thay.
--   * task_instances giữ nguyên: mọi việc theo ngày luôn có người chính.
-- =====================================================================

alter table public.task_templates alter column primary_employee_id drop not null;

alter table public.task_templates
  add constraint task_templates_backup_needs_primary
  check (backup_employee_id is null or primary_employee_id is not null);

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

  -- Chưa giao người chính → không có người thay; người thay trùng người chính → bỏ người thay
  if new.primary_employee_id is null or new.backup_employee_id = new.primary_employee_id then
    new.backup_employee_id := null;
  end if;

  -- Người thực hiện phải đang hoạt động và thuộc chi nhánh của mẫu
  if new.primary_employee_id is not null and not exists (
    select 1 from public.employees e
    join public.employee_branches eb on eb.employee_id = e.id and eb.branch_id = new.branch_id
    where e.id = new.primary_employee_id and e.is_active
  ) then
    raise exception 'Người phụ trách chính phải là nhân viên đang làm tại chi nhánh của công việc "%".', new.title using errcode = 'P0001';
  end if;
  if new.backup_employee_id is not null and not exists (
    select 1 from public.employees e
    join public.employee_branches eb on eb.employee_id = e.id and eb.branch_id = new.branch_id
    where e.id = new.backup_employee_id and e.is_active
  ) then
    raise exception 'Người thay thế phải là nhân viên đang làm tại chi nhánh của công việc "%".', new.title using errcode = 'P0001';
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

-- Đồng bộ: mẫu tạm ngưng HOẶC bỏ giao → hủy việc chưa làm từ hôm nay
create or replace function private.task_templates_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not new.is_active or new.primary_employee_id is null then
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

-- Chỉ sinh việc cho mẫu đã giao người chính
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
  where t.is_active and t.primary_employee_id is not null and private.task_scheduled_on(t, v_date)
  on conflict (template_id, task_date) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
