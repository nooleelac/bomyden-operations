-- =====================================================================
-- CHECKLIST: NHÂN VIÊN BÁO "CẦN GẤP" KHI ĐÁNH DẤU VIỆC (11/10/2026)
-- =====================================================================
--   * NV bật "Cần gấp" lúc Hoàn thành / Không đạt → bắt buộc ghi chú (≥ 3 ký tự).
--   * Báo đẩy ngay cho Quản lý chi nhánh + Quản trị viên (trừ chính người báo).
--   * QL/QTV bấm "Đã xử lý" → ghi người & giờ xử lý, đánh dấu đã đọc thông báo gấp của việc đó.
--   * Mở lại việc (Yêu cầu làm lại) → xóa cờ gấp.
-- =====================================================================

alter table public.task_instances
  add column is_urgent boolean not null default false,
  add column urgent_resolved_at timestamptz,
  add column urgent_resolved_by uuid references public.employees(id) on delete set null;

create index task_instances_urgent_resolved_by_idx on public.task_instances (urgent_resolved_by);
-- Việc gấp chưa xử lý (trang tổng quan / báo cáo)
create index task_instances_urgent_open_idx on public.task_instances (branch_id, task_date)
  where is_urgent and urgent_resolved_at is null;

alter type public.notification_kind add value if not exists 'task_urgent';

-- ---------------------------------------------------------------------
-- Hoàn thành / Không đạt (+ cờ gấp)
-- ---------------------------------------------------------------------
drop function public.complete_task_instance(uuid, uuid, public.task_status, text, text);

create function public.complete_task_instance(
  p_auth_uid uuid,
  p_instance_id uuid,
  p_status public.task_status,
  p_note text default null,
  p_photo_path text default null,
  p_urgent boolean default false
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

  if v_inst.by_shift then
    if not private.on_task_shift(v_inst.branch_id, v_inst.start_at, v_inst.due_at, v_emp.id) then
      raise exception 'Việc này giao theo ca — bạn không có ca trùng giờ việc hôm nay.' using errcode = '42501';
    end if;
  elsif v_emp.id = v_inst.primary_employee_id then
    null;
  elsif v_emp.id = v_inst.backup_employee_id then
    if private.checked_in_on(v_inst.primary_employee_id, v_inst.task_date) then
      raise exception 'Người phụ trách chính đã đi làm hôm nay nên việc này do họ thực hiện.' using errcode = 'P0001';
    end if;
  else
    raise exception 'Việc này không được giao cho bạn.' using errcode = '42501';
  end if;

  if v_emp.role <> 'admin' and v_emp.requires_attendance and not exists (
    select 1 from public.attendance_records a
    where a.employee_id = v_emp.id and a.check_out_at is null and a.branch_id = v_inst.branch_id
  ) then
    select b.name into v_branch from public.branches b where b.id = v_inst.branch_id;
    raise exception 'Bạn cần vào ca tại % trước khi đánh dấu công việc.', v_branch using errcode = 'P0001';
  end if;

  if p_status = 'failed' and char_length(coalesce(v_note, '')) < 3 then
    raise exception 'Vui lòng ghi lý do không hoàn thành được.' using errcode = 'P0001';
  end if;
  if p_urgent and char_length(coalesce(v_note, '')) < 3 then
    raise exception 'Báo "Cần gấp" thì ghi rõ việc cần quản lý xử lý.' using errcode = 'P0001';
  end if;
  if p_status = 'done' and v_inst.requires_note and v_note is null then
    raise exception 'Việc này bắt buộc ghi chú.' using errcode = 'P0001';
  end if;
  if p_status = 'done' and v_inst.requires_photo and p_photo_path is null then
    raise exception 'Việc này bắt buộc chụp ảnh.' using errcode = 'P0001';
  end if;

  update public.task_instances i set
    status             = p_status,
    completed_by       = v_emp.id,
    completed_at       = now(),
    note               = v_note,
    photo_path         = p_photo_path,
    is_urgent          = coalesce(p_urgent, false),
    urgent_resolved_at = null,
    urgent_resolved_by = null,
    updated_at         = now()
  where i.id = v_inst.id and i.status = 'pending'
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Việc này đã được đánh dấu trước đó.' using errcode = 'P0001';
  end if;

  if v_result.is_urgent then
    select b.name into v_branch from public.branches b where b.id = v_result.branch_id;
    -- Báo gấp lần trước (trước khi bị mở lại) → thay bằng thông báo mới
    delete from public.notifications where kind = 'task_urgent' and task_instance_id = v_result.id;
    insert into public.notifications (employee_id, kind, task_instance_id, title, body, url)
    select m.id, 'task_urgent', v_result.id,
           '🚨 Cần gấp: ' || v_result.title,
           v_emp.full_name || ' · ' || v_branch || ' — ' || left(v_note, 140),
           '/checklist/manage?branch=' || v_result.branch_id || '&urgent=1'
    from public.employees m
    where m.is_active and m.id <> v_emp.id and (
      m.role = 'admin'
      or (m.role = 'manager' and exists (
        select 1 from public.employee_branches eb where eb.employee_id = m.id and eb.branch_id = v_result.branch_id
      ))
    )
    on conflict (employee_id, kind, task_instance_id) do nothing;
    perform private.push_now();
  end if;

  return v_result;
end;
$$;

revoke all on function public.complete_task_instance(uuid, uuid, public.task_status, text, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_task_instance(uuid, uuid, public.task_status, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------
-- QL/QTV: đánh dấu đã xử lý việc gấp
-- ---------------------------------------------------------------------
create function public.resolve_task_urgent(p_instance_id uuid)
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
  if not v_inst.is_urgent then
    raise exception 'Việc này không được báo gấp.' using errcode = 'P0001';
  end if;
  if v_inst.urgent_resolved_at is not null then
    raise exception 'Việc gấp này đã được xử lý.' using errcode = 'P0001';
  end if;

  update public.task_instances i set
    urgent_resolved_at = now(),
    urgent_resolved_by = private.current_employee_id(),
    updated_at         = now()
  where i.id = v_inst.id
  returning * into v_result;

  update public.notifications n set read_at = now()
  where n.kind = 'task_urgent' and n.task_instance_id = v_inst.id and n.read_at is null;

  return v_result;
end;
$$;

revoke all on function public.resolve_task_urgent(uuid) from public, anon;
grant execute on function public.resolve_task_urgent(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Mở lại việc → xóa cờ gấp
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
    status             = 'pending',
    completed_by       = null,
    completed_at       = null,
    note               = null,
    photo_path         = null,
    is_urgent          = false,
    urgent_resolved_at = null,
    urgent_resolved_by = null,
    reopened_by        = private.current_employee_id(),
    reopened_at        = now(),
    reopen_reason      = btrim(p_reason),
    updated_at         = now()
  where i.id = v_inst.id
  returning * into v_result;
  return v_result;
end;
$$;
