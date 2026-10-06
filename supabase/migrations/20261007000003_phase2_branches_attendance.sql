-- =====================================================================
-- PHASE 2 — CHI NHÁNH, PHẠM VI QUẢN LÝ THEO CHI NHÁNH, CHẤM CÔNG
-- =====================================================================
-- Nghiệp vụ đã chốt:
--   * Quản trị viên không chấm công. Quản lý chấm công khi được Quản trị viên bật requires_attendance.
--   * Chấm công hợp lệ khi: IP thuộc Wi-Fi chi nhánh HOẶC GPS nằm trong bán kính chi nhánh.
--   * Nhân viên gán 1..n chi nhánh. Nhiều lượt/ngày nhưng tối đa 1 ca đang mở.
--   * Giờ chấm công = giờ máy chủ (now()).
--   * Quên ra ca: ca giữ mở; quá 16 giờ coi là "quên ra ca" → phải gửi yêu cầu sửa.
--   * Quản lý chỉ quản lý nhân viên & chấm công thuộc chi nhánh mình. Quản trị viên thấy tất cả.
--   * Chỉ Quản trị viên tạo/sửa chi nhánh. Không xóa dữ liệu, chỉ khóa / sửa có lý do.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. CHI NHÁNH
-- ---------------------------------------------------------------------
create table public.branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  address     text,
  latitude    double precision,
  longitude   double precision,
  radius_m    integer not null default 100,
  wifi_ips    inet[] not null default '{}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.employees (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.employees (id),

  constraint branches_name_len    check (char_length(btrim(name)) between 1 and 100),
  constraint branches_radius      check (radius_m between 20 and 2000),
  constraint branches_coords_pair check ((latitude is null) = (longitude is null)),
  constraint branches_lat         check (latitude is null or latitude between -90 and 90),
  constraint branches_lng         check (longitude is null or longitude between -180 and 180)
);

create index branches_created_by_idx on public.branches (created_by);
create index branches_updated_by_idx on public.branches (updated_by);

create table public.employee_branches (
  employee_id uuid not null references public.employees (id),
  branch_id   uuid not null references public.branches (id),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.employees (id),
  primary key (employee_id, branch_id)
);

create index employee_branches_branch_idx     on public.employee_branches (branch_id);
create index employee_branches_created_by_idx on public.employee_branches (created_by);

-- ---------------------------------------------------------------------
-- 2. NHÂN VIÊN: CỜ "PHẢI CHẤM CÔNG"
-- ---------------------------------------------------------------------
alter table public.employees
  add column requires_attendance boolean not null default true;

update public.employees set requires_attendance = false where role = 'admin';

comment on column public.employees.requires_attendance is
  'Có phải chấm công không. Quản trị viên luôn false. Với Quản lý chỉ Quản trị viên được thay đổi.';

-- ---------------------------------------------------------------------
-- 3. HÀM PHÂN QUYỀN THEO CHI NHÁNH
-- ---------------------------------------------------------------------
create or replace function private.manages_branch(p_branch_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case private.current_employee_role()
    when 'admin' then true
    when 'manager' then exists (
      select 1 from public.employee_branches eb
      where eb.employee_id = private.current_employee_id()
        and eb.branch_id = p_branch_id
    )
    else false
  end
$$;

-- Quản lý "quản lý" một nhân viên khi hai người cùng thuộc ít nhất 1 chi nhánh
create or replace function private.manages_employee(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case private.current_employee_role()
    when 'admin' then true
    when 'manager' then exists (
      select 1
      from public.employee_branches mine
      join public.employee_branches theirs on theirs.branch_id = mine.branch_id
      where mine.employee_id = private.current_employee_id()
        and theirs.employee_id = p_employee_id
    )
    else false
  end
$$;

revoke all on function private.manages_branch(uuid)   from public;
revoke all on function private.manages_employee(uuid) from public;
grant execute on function private.manages_branch(uuid)   to authenticated, service_role;
grant execute on function private.manages_employee(uuid) to authenticated, service_role;

-- Khoảng cách (mét) giữa 2 tọa độ — công thức haversine
create or replace function private.distance_m(lat1 double precision, lng1 double precision,
                                              lat2 double precision, lng2 double precision)
returns double precision
language sql immutable
set search_path = ''
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- ---------------------------------------------------------------------
-- 4. CẬP NHẬT TRIGGER NHÂN VIÊN (thêm quy tắc requires_attendance)
-- ---------------------------------------------------------------------
create or replace function private.employees_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor_id   uuid;
  v_actor_role public.employee_role;
  v_admins     integer;
begin
  new.full_name := btrim(new.full_name);
  new.email     := nullif(lower(btrim(new.email)), '');
  new.phone     := nullif(btrim(new.phone), '');

  -- Quản trị viên không chấm công
  if new.role = 'admin' then
    new.requires_attendance := false;
  end if;

  if tg_op = 'INSERT' or new.is_active is distinct from old.is_active then
    if new.is_active then
      new.deactivated_at := null;
      new.deactivated_by := null;
    else
      new.deactivated_at := coalesce(new.deactivated_at, now());
    end if;
  end if;

  new.updated_at := now();

  if (select auth.uid()) is null then
    return new;
  end if;

  select e.id, e.role into v_actor_id, v_actor_role
  from public.employees e
  where e.auth_user_id = (select auth.uid()) and e.is_active;

  if v_actor_id is null or v_actor_role not in ('admin', 'manager') then
    raise exception 'Bạn không có quyền quản lý nhân viên.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := v_actor_id;
    new.updated_by := v_actor_id;
    new.created_at := now();
    if new.role = 'admin' and v_actor_role <> 'admin' then
      raise exception 'Chỉ Quản trị viên mới được tạo tài khoản Quản trị viên.' using errcode = '42501';
    end if;
    if new.role = 'manager' and v_actor_role <> 'admin' and not new.requires_attendance then
      raise exception 'Chỉ Quản trị viên mới được tắt chấm công cho Quản lý.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  new.updated_by := v_actor_id;
  new.created_at := old.created_at;
  new.created_by := old.created_by;

  if new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'Không được thay đổi tài khoản đăng nhập liên kết.' using errcode = '42501';
  end if;

  if v_actor_role <> 'admin' and (old.role = 'admin' or new.role = 'admin') then
    raise exception 'Chỉ Quản trị viên mới được thay đổi tài khoản Quản trị viên.' using errcode = '42501';
  end if;

  if new.requires_attendance is distinct from old.requires_attendance
     and v_actor_role <> 'admin'
     and (old.role = 'manager' or new.role = 'manager') then
    raise exception 'Chỉ Quản trị viên mới được bật/tắt chấm công cho Quản lý.' using errcode = '42501';
  end if;

  if old.id = v_actor_id then
    if new.role is distinct from old.role then
      raise exception 'Bạn không thể tự thay đổi chức vụ của mình.' using errcode = '42501';
    end if;
    if not new.is_active then
      raise exception 'Bạn không thể tự khóa tài khoản của mình.' using errcode = '42501';
    end if;
    if new.requires_attendance is distinct from old.requires_attendance then
      raise exception 'Bạn không thể tự bật/tắt chấm công của mình.' using errcode = '42501';
    end if;
  end if;

  if not new.is_active and old.is_active then
    new.deactivated_by := v_actor_id;
  end if;

  if old.role = 'admin' and old.is_active and (new.role <> 'admin' or not new.is_active) then
    select count(*) into v_admins
    from public.employees e
    where e.role = 'admin' and e.is_active and e.id <> old.id;
    if v_admins = 0 then
      raise exception 'Hệ thống phải còn ít nhất một Quản trị viên đang hoạt động.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Audit log dùng chung cho mọi bảng (kể cả bảng không có cột id)
create or replace function private.write_audit_log()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
begin
  insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, old_data, new_data)
  values (
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'employee_id', v_old ->> 'employee_id')::uuid,
    tg_op,
    (select auth.uid()),
    private.current_employee_id(),
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. TRIGGER CHI NHÁNH
-- ---------------------------------------------------------------------
create or replace function private.branches_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.name       := btrim(new.name);
  new.address    := nullif(btrim(new.address), '');
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

create trigger branches_guard
before insert or update on public.branches
for each row execute function private.branches_guard();

create trigger branches_forbid_delete
before delete on public.branches
for each row execute function private.forbid_delete();

create trigger branches_audit
after insert or update on public.branches
for each row execute function private.write_audit_log();

create trigger employee_branches_audit
after insert or delete on public.employee_branches
for each row execute function private.write_audit_log();

-- ---------------------------------------------------------------------
-- 6. CHẤM CÔNG
-- ---------------------------------------------------------------------
create type public.attendance_method as enum ('gps', 'wifi', 'manual');

create table public.attendance_records (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.employees (id),
  branch_id            uuid not null references public.branches (id),

  check_in_at          timestamptz not null,
  check_in_method      public.attendance_method not null,
  check_in_lat         double precision,
  check_in_lng         double precision,
  check_in_accuracy_m  real,
  check_in_distance_m  real,
  check_in_ip          inet,

  check_out_at         timestamptz,
  check_out_method     public.attendance_method,
  check_out_lat        double precision,
  check_out_lng        double precision,
  check_out_accuracy_m real,
  check_out_distance_m real,
  check_out_ip         inet,

  is_corrected         boolean not null default false,
  correction_note      text,
  last_corrected_by    uuid references public.employees (id),
  last_corrected_at    timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint attendance_out_after_in  check (check_out_at is null or check_out_at > check_in_at),
  constraint attendance_out_method    check ((check_out_at is null) = (check_out_method is null)),
  constraint attendance_max_24h       check (check_out_at is null or check_out_at - check_in_at <= interval '24 hours'),
  -- Không cho 2 ca của cùng 1 người chồng thời gian lên nhau
  constraint attendance_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(check_in_at, coalesce(check_out_at, 'infinity'::timestamptz), '[)') with &&
  )
);

-- Tối đa 1 ca đang mở / người
create unique index attendance_one_open_per_employee
  on public.attendance_records (employee_id) where check_out_at is null;
create index attendance_employee_time_idx on public.attendance_records (employee_id, check_in_at desc);
create index attendance_branch_time_idx   on public.attendance_records (branch_id, check_in_at desc);
create index attendance_corrected_by_idx  on public.attendance_records (last_corrected_by);

create trigger attendance_records_forbid_delete
before delete on public.attendance_records
for each row execute function private.forbid_delete();

create trigger attendance_records_audit
after update on public.attendance_records
for each row execute function private.write_audit_log();

-- ---------------------------------------------------------------------
-- 7. YÊU CẦU SỬA CHẤM CÔNG
-- ---------------------------------------------------------------------
create type public.correction_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.attendance_corrections (
  id                     uuid primary key default gen_random_uuid(),
  attendance_id          uuid not null references public.attendance_records (id),
  employee_id            uuid not null references public.employees (id),
  branch_id              uuid not null references public.branches (id),
  requested_check_in_at  timestamptz not null,
  requested_check_out_at timestamptz not null,
  reason                 text not null,
  status                 public.correction_status not null default 'pending',
  reviewed_by            uuid references public.employees (id),
  reviewed_at            timestamptz,
  review_note            text,
  applied_check_in_at    timestamptz,
  applied_check_out_at   timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint corrections_times     check (requested_check_out_at > requested_check_in_at),
  constraint corrections_reason    check (char_length(btrim(reason)) between 3 and 500)
);

create unique index attendance_corrections_one_pending
  on public.attendance_corrections (attendance_id) where status = 'pending';
create index attendance_corrections_employee_idx on public.attendance_corrections (employee_id, created_at desc);
create index attendance_corrections_branch_idx   on public.attendance_corrections (branch_id, status);
create index attendance_corrections_reviewer_idx on public.attendance_corrections (reviewed_by);

create trigger attendance_corrections_forbid_delete
before delete on public.attendance_corrections
for each row execute function private.forbid_delete();

create trigger attendance_corrections_audit
after insert or update on public.attendance_corrections
for each row execute function private.write_audit_log();

-- ---------------------------------------------------------------------
-- 8. HÀM NỘI BỘ: XÁC ĐỊNH CHI NHÁNH THEO VỊ TRÍ
-- ---------------------------------------------------------------------
-- Trả về chi nhánh hợp lệ (trong số chi nhánh của nhân viên, hoặc đúng p_only_branch nếu có).
-- Ưu tiên Wi-Fi, sau đó GPS gần nhất trong bán kính.
create or replace function private.resolve_branch(
  p_employee_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy real,
  p_ip inet,
  p_only_branch uuid default null,
  out branch_id uuid,
  out method public.attendance_method,
  out distance_m real,
  out nearest_name text,
  out nearest_distance_m real
)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  r record;
  v_dist double precision;
begin
  -- 1. Wi-Fi
  if p_ip is not null then
    select b.id into branch_id
    from public.branches b
    join public.employee_branches eb on eb.branch_id = b.id and eb.employee_id = p_employee_id
    where b.is_active
      and (p_only_branch is null or b.id = p_only_branch)
      and p_ip = any (b.wifi_ips)
    limit 1;
    if branch_id is not null then
      method := 'wifi';
      return;
    end if;
  end if;

  -- 2. GPS
  if p_lat is null or p_lng is null then
    return;
  end if;

  for r in
    select b.id, b.name, b.radius_m,
           private.distance_m(p_lat, p_lng, b.latitude, b.longitude) as dist
    from public.branches b
    join public.employee_branches eb on eb.branch_id = b.id and eb.employee_id = p_employee_id
    where b.is_active
      and b.latitude is not null
      and (p_only_branch is null or b.id = p_only_branch)
    order by 4
  loop
    if nearest_name is null then
      nearest_name := r.name;
      nearest_distance_m := r.dist;
    end if;
    v_dist := r.dist;
    -- GPS sai số quá lớn (> 200m) thì không tin
    if v_dist <= r.radius_m and coalesce(p_accuracy, 0) <= 200 then
      branch_id  := r.id;
      method     := 'gps';
      distance_m := v_dist;
      return;
    end if;
  end loop;
end;
$$;

revoke all on function private.resolve_branch(uuid, double precision, double precision, real, inet, uuid) from public;

-- Đặt ngữ cảnh người dùng (để trigger audit ghi đúng người) khi hàm được server gọi bằng service_role
create or replace function private.act_as(p_auth_uid uuid)
returns void
language sql
set search_path = ''
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_auth_uid, 'role', 'authenticated')::text, true)
$$;

revoke all on function private.act_as(uuid) from public;

-- ---------------------------------------------------------------------
-- 9. RPC: VÀO CA / RA CA (CHỈ SERVER GỌI — service_role)
-- ---------------------------------------------------------------------
-- Server Next.js đã xác thực phiên và tự đọc IP thật của người dùng rồi mới gọi hàm này,
-- nên người dùng không thể tự gọi để giả IP Wi-Fi.
create or replace function public.attendance_check_in(
  p_auth_uid uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy real default null,
  p_ip inet default null
)
returns public.attendance_records
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_emp     public.employees;
  v_open    public.attendance_records;
  v_branch  record;
  v_result  public.attendance_records;
  v_branch_count integer;
begin
  perform private.act_as(p_auth_uid);

  select * into v_emp from public.employees e where e.auth_user_id = p_auth_uid and e.is_active;
  if v_emp.id is null then
    raise exception 'Tài khoản không hợp lệ hoặc đã bị khóa.' using errcode = '42501';
  end if;
  if v_emp.role = 'admin' then
    raise exception 'Quản trị viên không cần chấm công.' using errcode = 'P0001';
  end if;
  if not v_emp.requires_attendance then
    raise exception 'Tài khoản của bạn không cần chấm công.' using errcode = 'P0001';
  end if;

  select * into v_open from public.attendance_records a
  where a.employee_id = v_emp.id and a.check_out_at is null;
  if v_open.id is not null then
    if now() - v_open.check_in_at > interval '16 hours' then
      raise exception 'Bạn có ca chưa ra từ trước (quên ra ca). Hãy gửi yêu cầu sửa trước khi vào ca mới.' using errcode = 'P0001';
    end if;
    raise exception 'Bạn đang trong ca rồi.' using errcode = 'P0001';
  end if;

  select count(*) into v_branch_count
  from public.employee_branches eb join public.branches b on b.id = eb.branch_id
  where eb.employee_id = v_emp.id and b.is_active;
  if v_branch_count = 0 then
    raise exception 'Bạn chưa được gán chi nhánh. Vui lòng liên hệ quản lý.' using errcode = 'P0001';
  end if;

  select * into v_branch from private.resolve_branch(v_emp.id, p_lat, p_lng, p_accuracy, p_ip);
  if v_branch.branch_id is null then
    if p_lat is null then
      raise exception 'Không xác định được vị trí. Hãy bật định vị (GPS) hoặc kết nối Wi-Fi của quán.' using errcode = 'P0001';
    elsif coalesce(p_accuracy, 0) > 200 then
      raise exception 'Vị trí GPS chưa chính xác (sai số % m). Hãy ra chỗ thoáng hoặc dùng Wi-Fi của quán.', round(p_accuracy) using errcode = 'P0001';
    elsif v_branch.nearest_name is not null then
      raise exception 'Bạn đang ở ngoài khu vực chấm công (cách % khoảng % m).', v_branch.nearest_name, round(v_branch.nearest_distance_m) using errcode = 'P0001';
    else
      raise exception 'Chi nhánh của bạn chưa được cài đặt vị trí. Vui lòng liên hệ quản lý.' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.attendance_records (
      employee_id, branch_id, check_in_at, check_in_method,
      check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m, check_in_ip
    ) values (
      v_emp.id, v_branch.branch_id, now(), v_branch.method,
      p_lat, p_lng, p_accuracy, v_branch.distance_m, p_ip
    )
    returning * into v_result;
  exception
    when unique_violation or exclusion_violation then
      raise exception 'Bạn đang trong ca rồi.' using errcode = 'P0001';
  end;

  return v_result;
end;
$$;

create or replace function public.attendance_check_out(
  p_auth_uid uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy real default null,
  p_ip inet default null
)
returns public.attendance_records
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_emp    public.employees;
  v_open   public.attendance_records;
  v_branch record;
  v_result public.attendance_records;
begin
  perform private.act_as(p_auth_uid);

  select * into v_emp from public.employees e where e.auth_user_id = p_auth_uid and e.is_active;
  if v_emp.id is null then
    raise exception 'Tài khoản không hợp lệ hoặc đã bị khóa.' using errcode = '42501';
  end if;

  select * into v_open from public.attendance_records a
  where a.employee_id = v_emp.id and a.check_out_at is null
  for update;
  if v_open.id is null then
    raise exception 'Bạn chưa vào ca.' using errcode = 'P0001';
  end if;
  if now() - v_open.check_in_at > interval '16 hours' then
    raise exception 'Ca này đã quá 16 giờ (quên ra ca). Hãy gửi yêu cầu sửa để quản lý chấm lại.' using errcode = 'P0001';
  end if;

  -- Phải ra ca tại đúng chi nhánh đã vào ca
  select * into v_branch from private.resolve_branch(v_emp.id, p_lat, p_lng, p_accuracy, p_ip, v_open.branch_id);
  if v_branch.branch_id is null then
    if p_lat is null then
      raise exception 'Không xác định được vị trí. Hãy bật định vị (GPS) hoặc kết nối Wi-Fi của quán.' using errcode = 'P0001';
    elsif coalesce(p_accuracy, 0) > 200 then
      raise exception 'Vị trí GPS chưa chính xác (sai số % m). Hãy ra chỗ thoáng hoặc dùng Wi-Fi của quán.', round(p_accuracy) using errcode = 'P0001';
    else
      raise exception 'Bạn phải ra ca tại chi nhánh đã vào ca (đang cách khoảng % m).', round(coalesce(v_branch.nearest_distance_m, 0)) using errcode = 'P0001';
    end if;
  end if;

  update public.attendance_records a set
    check_out_at         = now(),
    check_out_method     = v_branch.method,
    check_out_lat        = p_lat,
    check_out_lng        = p_lng,
    check_out_accuracy_m = p_accuracy,
    check_out_distance_m = v_branch.distance_m,
    check_out_ip         = p_ip,
    updated_at           = now()
  where a.id = v_open.id and a.check_out_at is null
  returning * into v_result;

  if v_result.id is null then
    raise exception 'Ca đã được kết thúc trước đó.' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. RPC: YÊU CẦU SỬA (nhân viên)
-- ---------------------------------------------------------------------
create or replace function public.request_attendance_correction(
  p_attendance_id uuid,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_reason text
)
returns public.attendance_corrections
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_employee_id();
  v_rec    public.attendance_records;
  v_result public.attendance_corrections;
begin
  if v_me is null then
    raise exception 'Bạn chưa đăng nhập.' using errcode = '42501';
  end if;

  select * into v_rec from public.attendance_records a where a.id = p_attendance_id;
  if v_rec.id is null or v_rec.employee_id <> v_me then
    raise exception 'Không tìm thấy ca làm của bạn.' using errcode = 'P0001';
  end if;
  if p_check_out_at <= p_check_in_at then
    raise exception 'Giờ ra phải sau giờ vào.' using errcode = 'P0001';
  end if;
  if p_check_out_at > now() then
    raise exception 'Giờ ra không được ở tương lai.' using errcode = 'P0001';
  end if;
  if p_check_out_at - p_check_in_at > interval '24 hours' then
    raise exception 'Một ca không được dài quá 24 giờ.' using errcode = 'P0001';
  end if;

  begin
    insert into public.attendance_corrections (
      attendance_id, employee_id, branch_id, requested_check_in_at, requested_check_out_at, reason
    ) values (
      v_rec.id, v_me, v_rec.branch_id, p_check_in_at, p_check_out_at, btrim(p_reason)
    )
    returning * into v_result;
  exception when unique_violation then
    raise exception 'Ca này đã có yêu cầu đang chờ duyệt.' using errcode = 'P0001';
  end;

  return v_result;
end;
$$;

create or replace function public.cancel_attendance_correction(p_correction_id uuid)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.attendance_corrections c
  set status = 'cancelled', updated_at = now()
  where c.id = p_correction_id
    and c.employee_id = private.current_employee_id()
    and c.status = 'pending';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Không thể hủy yêu cầu này (không phải của bạn hoặc đã được xử lý).' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. RPC: QUẢN LÝ DUYỆT / SỬA / THÊM CA
-- ---------------------------------------------------------------------
-- Áp giờ mới vào một bản ghi chấm công (dùng chung)
create or replace function private.apply_attendance_times(
  p_rec public.attendance_records,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_note text,
  p_actor uuid
)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  if p_check_out_at <= p_check_in_at then
    raise exception 'Giờ ra phải sau giờ vào.' using errcode = 'P0001';
  end if;
  if p_check_out_at > now() then
    raise exception 'Giờ ra không được ở tương lai.' using errcode = 'P0001';
  end if;
  if p_check_out_at - p_check_in_at > interval '24 hours' then
    raise exception 'Một ca không được dài quá 24 giờ.' using errcode = 'P0001';
  end if;

  begin
    update public.attendance_records a set
      check_in_at       = p_check_in_at,
      check_out_at      = p_check_out_at,
      check_out_method  = case when p_rec.check_out_at is null then 'manual'::public.attendance_method else a.check_out_method end,
      is_corrected      = true,
      correction_note   = p_note,
      last_corrected_by = p_actor,
      last_corrected_at = now(),
      updated_at        = now()
    where a.id = p_rec.id;
  exception when exclusion_violation then
    raise exception 'Giờ mới bị trùng với một ca khác của nhân viên này.' using errcode = 'P0001';
  end;
end;
$$;

revoke all on function private.apply_attendance_times(public.attendance_records, timestamptz, timestamptz, text, uuid) from public;

create or replace function public.review_attendance_correction(
  p_correction_id uuid,
  p_approve boolean,
  p_check_in_at timestamptz default null,
  p_check_out_at timestamptz default null,
  p_note text default null
)
returns public.attendance_corrections
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_employee_id();
  v_corr   public.attendance_corrections;
  v_rec    public.attendance_records;
  v_in     timestamptz;
  v_out    timestamptz;
  v_result public.attendance_corrections;
begin
  select * into v_corr from public.attendance_corrections c where c.id = p_correction_id for update;
  if v_corr.id is null or not private.manages_branch(v_corr.branch_id) then
    raise exception 'Không tìm thấy yêu cầu hoặc bạn không có quyền xử lý.' using errcode = '42501';
  end if;
  if v_corr.employee_id = v_me then
    raise exception 'Bạn không thể tự duyệt yêu cầu của mình.' using errcode = '42501';
  end if;
  if v_corr.status <> 'pending' then
    raise exception 'Yêu cầu này đã được xử lý.' using errcode = 'P0001';
  end if;

  if p_approve then
    v_in  := coalesce(p_check_in_at, v_corr.requested_check_in_at);
    v_out := coalesce(p_check_out_at, v_corr.requested_check_out_at);
    select * into v_rec from public.attendance_records a where a.id = v_corr.attendance_id for update;
    perform private.apply_attendance_times(
      v_rec, v_in, v_out,
      'Duyệt yêu cầu sửa: ' || v_corr.reason || coalesce(' — ' || nullif(btrim(p_note), ''), ''),
      v_me
    );
  end if;

  update public.attendance_corrections c set
    status               = case when p_approve then 'approved'::public.correction_status else 'rejected'::public.correction_status end,
    reviewed_by          = v_me,
    reviewed_at          = now(),
    review_note          = nullif(btrim(p_note), ''),
    applied_check_in_at  = v_in,
    applied_check_out_at = v_out,
    updated_at           = now()
  where c.id = v_corr.id and c.status = 'pending'
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.correct_attendance(
  p_attendance_id uuid,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_reason text
)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me  uuid := private.current_employee_id();
  v_rec public.attendance_records;
begin
  select * into v_rec from public.attendance_records a where a.id = p_attendance_id for update;
  if v_rec.id is null or not private.manages_branch(v_rec.branch_id) then
    raise exception 'Không tìm thấy ca làm hoặc bạn không có quyền sửa.' using errcode = '42501';
  end if;
  if v_rec.employee_id = v_me then
    raise exception 'Bạn không thể tự sửa chấm công của mình.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Vui lòng nhập lý do sửa.' using errcode = 'P0001';
  end if;

  perform private.apply_attendance_times(v_rec, p_check_in_at, p_check_out_at, 'Sửa trực tiếp: ' || btrim(p_reason), v_me);

  -- Yêu cầu đang chờ của ca này không còn ý nghĩa
  update public.attendance_corrections c set
    status = 'rejected', reviewed_by = v_me, reviewed_at = now(),
    review_note = 'Quản lý đã sửa trực tiếp ca này.', updated_at = now()
  where c.attendance_id = v_rec.id and c.status = 'pending';
end;
$$;

-- Thêm ca thủ công (nhân viên quên vào ca hoàn toàn)
create or replace function public.add_manual_attendance(
  p_employee_id uuid,
  p_branch_id uuid,
  p_check_in_at timestamptz,
  p_check_out_at timestamptz,
  p_reason text
)
returns public.attendance_records
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me     uuid := private.current_employee_id();
  v_result public.attendance_records;
begin
  if not private.manages_branch(p_branch_id) then
    raise exception 'Bạn không có quyền với chi nhánh này.' using errcode = '42501';
  end if;
  if p_employee_id = v_me then
    raise exception 'Bạn không thể tự thêm ca cho mình.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.employee_branches eb
    join public.employees e on e.id = eb.employee_id
    where eb.employee_id = p_employee_id and eb.branch_id = p_branch_id and e.is_active
  ) then
    raise exception 'Nhân viên không thuộc chi nhánh này.' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Vui lòng nhập lý do.' using errcode = 'P0001';
  end if;
  if p_check_out_at <= p_check_in_at then
    raise exception 'Giờ ra phải sau giờ vào.' using errcode = 'P0001';
  end if;
  if p_check_out_at > now() then
    raise exception 'Giờ ra không được ở tương lai.' using errcode = 'P0001';
  end if;
  if p_check_out_at - p_check_in_at > interval '24 hours' then
    raise exception 'Một ca không được dài quá 24 giờ.' using errcode = 'P0001';
  end if;

  begin
    insert into public.attendance_records (
      employee_id, branch_id, check_in_at, check_in_method, check_out_at, check_out_method,
      is_corrected, correction_note, last_corrected_by, last_corrected_at
    ) values (
      p_employee_id, p_branch_id, p_check_in_at, 'manual', p_check_out_at, 'manual',
      true, 'Thêm thủ công: ' || btrim(p_reason), v_me, now()
    )
    returning * into v_result;
  exception when exclusion_violation then
    raise exception 'Ca này bị trùng thời gian với một ca khác của nhân viên.' using errcode = 'P0001';
  end;

  insert into public.audit_logs (table_name, record_id, action, actor_auth_uid, actor_employee_id, new_data, note)
  values ('attendance_records', v_result.id, 'MANUAL_INSERT', (select auth.uid()), v_me, to_jsonb(v_result), btrim(p_reason));

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------
-- 12. RPC: TẠO / SỬA NHÂN VIÊN KÈM CHI NHÁNH (nguyên tử)
-- ---------------------------------------------------------------------
-- Kiểm tra & ghi danh sách chi nhánh cho nhân viên theo phạm vi người thao tác.
-- Quản lý chỉ thêm/bớt các chi nhánh mình quản lý; chi nhánh khác của nhân viên được giữ nguyên.
create or replace function private.set_employee_branches(p_employee_id uuid, p_branch_ids uuid[])
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me       uuid := private.current_employee_id();
  v_is_admin boolean := private.is_admin();
  v_ids      uuid[] := coalesce(p_branch_ids, '{}');
  v_bad      uuid;
begin
  -- Chi nhánh phải tồn tại và nằm trong phạm vi
  select x into v_bad
  from unnest(v_ids) as x
  where not exists (select 1 from public.branches b where b.id = x and b.is_active)
     or not private.manages_branch(x)
  limit 1;
  if v_bad is not null then
    raise exception 'Có chi nhánh không hợp lệ hoặc ngoài phạm vi quản lý của bạn.' using errcode = '42501';
  end if;

  -- Xóa các chi nhánh (trong phạm vi) không còn được chọn
  delete from public.employee_branches eb
  where eb.employee_id = p_employee_id
    and (v_is_admin or private.manages_branch(eb.branch_id))
    and not (eb.branch_id = any (v_ids));

  insert into public.employee_branches (employee_id, branch_id, created_by)
  select p_employee_id, x, v_me from unnest(v_ids) as x
  on conflict do nothing;
end;
$$;

revoke all on function private.set_employee_branches(uuid, uuid[]) from public;

create or replace function public.create_employee(
  p_auth_user_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_role public.employee_role,
  p_default_start_time time,
  p_sort_order integer,
  p_requires_attendance boolean,
  p_branch_ids uuid[]
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_role public.employee_role := private.current_employee_role();
  v_id   uuid;
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'Bạn không có quyền quản lý nhân viên.' using errcode = '42501';
  end if;
  if v_role = 'manager' and coalesce(cardinality(p_branch_ids), 0) = 0 then
    raise exception 'Vui lòng chọn ít nhất một chi nhánh.' using errcode = 'P0001';
  end if;

  -- Trigger employees_guard kiểm tra quyền chức vụ / chấm công
  insert into public.employees (
    auth_user_id, full_name, email, phone, role, default_start_time, sort_order, requires_attendance
  ) values (
    p_auth_user_id, p_full_name, p_email, p_phone, p_role, p_default_start_time,
    coalesce(p_sort_order, 0), coalesce(p_requires_attendance, true)
  )
  returning id into v_id;

  perform private.set_employee_branches(v_id, p_branch_ids);
  return v_id;
end;
$$;

create or replace function public.update_employee(
  p_employee_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_role public.employee_role,
  p_default_start_time time,
  p_sort_order integer,
  p_requires_attendance boolean,
  p_branch_ids uuid[]
)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_role public.employee_role := private.current_employee_role();
  v_count integer;
begin
  if v_role is null or v_role not in ('admin', 'manager') or not private.manages_employee(p_employee_id) then
    raise exception 'Bạn không có quyền sửa nhân viên này.' using errcode = '42501';
  end if;

  update public.employees e set
    full_name           = p_full_name,
    email               = p_email,
    phone               = p_phone,
    role                = p_role,
    default_start_time  = p_default_start_time,
    sort_order          = coalesce(p_sort_order, 0),
    requires_attendance = coalesce(p_requires_attendance, e.requires_attendance)
  where e.id = p_employee_id;

  perform private.set_employee_branches(p_employee_id, p_branch_ids);

  -- Quản lý không được để nhân viên mất hết chi nhánh trong phạm vi của mình rồi "mất dấu"
  if v_role = 'manager' then
    select count(*) into v_count from public.employee_branches eb where eb.employee_id = p_employee_id;
    if v_count = 0 then
      raise exception 'Nhân viên phải thuộc ít nhất một chi nhánh.' using errcode = 'P0001';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. QUYỀN THỰC THI HÀM
-- ---------------------------------------------------------------------
revoke all on function public.attendance_check_in(uuid, double precision, double precision, real, inet)  from public, anon, authenticated;
revoke all on function public.attendance_check_out(uuid, double precision, double precision, real, inet) from public, anon, authenticated;
grant execute on function public.attendance_check_in(uuid, double precision, double precision, real, inet)  to service_role;
grant execute on function public.attendance_check_out(uuid, double precision, double precision, real, inet) to service_role;

revoke all on function public.request_attendance_correction(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.cancel_attendance_correction(uuid) from public, anon;
revoke all on function public.review_attendance_correction(uuid, boolean, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.correct_attendance(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.add_manual_attendance(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.create_employee(uuid, text, text, text, public.employee_role, time, integer, boolean, uuid[]) from public, anon;
revoke all on function public.update_employee(uuid, text, text, text, public.employee_role, time, integer, boolean, uuid[]) from public, anon;

grant execute on function public.request_attendance_correction(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.cancel_attendance_correction(uuid) to authenticated;
grant execute on function public.review_attendance_correction(uuid, boolean, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.correct_attendance(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.add_manual_attendance(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.create_employee(uuid, text, text, text, public.employee_role, time, integer, boolean, uuid[]) to authenticated;
grant execute on function public.update_employee(uuid, text, text, text, public.employee_role, time, integer, boolean, uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- 14. RLS
-- ---------------------------------------------------------------------
alter table public.branches               enable row level security;
alter table public.employee_branches      enable row level security;
alter table public.attendance_records     enable row level security;
alter table public.attendance_corrections enable row level security;

revoke all on public.branches               from anon;
revoke all on public.employee_branches      from anon;
revoke all on public.attendance_records     from anon;
revoke all on public.attendance_corrections from anon;

-- Ghi chỉ qua RPC (trừ branches: Quản trị viên ghi trực tiếp)
revoke insert, update, delete, truncate on public.employee_branches      from authenticated;
revoke insert, update, delete, truncate on public.attendance_records     from authenticated;
revoke insert, update, delete, truncate on public.attendance_corrections from authenticated;
revoke delete, truncate on public.branches from authenticated;

-- EMPLOYEES: thay chính sách Phase 1 bằng phạm vi theo chi nhánh
drop policy if exists "employees_select_self_or_manager" on public.employees;
drop policy if exists "employees_insert_manager" on public.employees;
drop policy if exists "employees_update_manager" on public.employees;
revoke insert on public.employees from authenticated;  -- tạo nhân viên qua RPC create_employee

create policy "employees_select_self_or_scope"
on public.employees for select
to authenticated
using (
  auth_user_id = (select auth.uid())
  or (select private.manages_employee(id))
);

create policy "employees_update_scope"
on public.employees for update
to authenticated
using ((select private.manages_employee(id)))
with check ((select private.manages_employee(id)));

-- BRANCHES
create policy "branches_select_employees"
on public.branches for select
to authenticated
using ((select private.current_employee_id()) is not null);

create policy "branches_insert_admin"
on public.branches for insert
to authenticated
with check ((select private.is_admin()));

create policy "branches_update_admin"
on public.branches for update
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

-- EMPLOYEE_BRANCHES
create policy "employee_branches_select"
on public.employee_branches for select
to authenticated
using (
  employee_id = (select private.current_employee_id())
  or (select private.manages_employee(employee_id))
);

-- ATTENDANCE
create policy "attendance_select_own_or_branch"
on public.attendance_records for select
to authenticated
using (
  employee_id = (select private.current_employee_id())
  or (select private.manages_branch(branch_id))
);

create policy "corrections_select_own_or_branch"
on public.attendance_corrections for select
to authenticated
using (
  employee_id = (select private.current_employee_id())
  or (select private.manages_branch(branch_id))
);
