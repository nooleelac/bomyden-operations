-- =====================================================================
-- THÔNG BÁO VIỆC SẮP QUÁ HẠN / QUÁ HẠN (Web Push) + TỰ DỌN ẢNH CHECKLIST CŨ
-- =====================================================================
-- Nghiệp vụ đã chốt (08/10/2026):
--   * Thông báo trên app, đẩy thẳng tới điện thoại (kể cả khi tắt màn hình) — Web Push.
--   * Báo trước hạn chót 30 phút cho người phụ trách (người chính; người thay thế nếu người chính
--     chưa chấm công hôm đó). Quá hạn: báo người phụ trách + Quản lý chi nhánh + Quản trị viên.
--   * Ảnh checklist cũ hơn 3 tháng tự xóa khỏi kho (giữ dòng lịch sử trong DB).
-- Cách chạy: pg_cron mỗi phút gọi private.run_task_reminders() → ghi bảng notifications →
--   nếu có thông báo cần đẩy thì gọi Edge Function "ops-jobs" (pg_net) để gửi Web Push.
--   Hằng đêm 03:00 (giờ VN) gọi private.run_daily_cleanup() → Edge Function xóa ảnh.
-- Bí mật (khóa VAPID, mã gọi cron, URL hàm) lưu trong Supabase Vault, đặt bằng scripts/setup-push.mjs.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- 1. BÍ MẬT TRONG VAULT
-- ---------------------------------------------------------------------
create or replace function private.ops_secret(p_name text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = p_name limit 1
$$;
revoke all on function private.ops_secret(text) from public;

-- Chỉ server (secret key) gọi được — dùng bởi scripts/setup-push.mjs
create or replace function public.service_set_secret(p_name text, p_value text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_name not in ('vapid_public_key', 'vapid_private_key', 'vapid_subject', 'ops_cron_secret', 'ops_jobs_url') then
    raise exception 'Tên bí mật không hợp lệ.' using errcode = 'P0001';
  end if;
  select s.id into v_id from vault.secrets s where s.name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end;
$$;

-- Cấu hình cho Edge Function
create or replace function public.service_ops_config()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'vapid_public_key', private.ops_secret('vapid_public_key'),
    'vapid_private_key', private.ops_secret('vapid_private_key'),
    'vapid_subject', private.ops_secret('vapid_subject'),
    'cron_secret', private.ops_secret('ops_cron_secret')
  )
$$;

-- ---------------------------------------------------------------------
-- 2. ĐĂNG KÝ NHẬN THÔNG BÁO (mỗi thiết bị một dòng)
-- ---------------------------------------------------------------------
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint push_subscriptions_endpoint check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  constraint push_subscriptions_keys check (char_length(p256dh) <= 200 and char_length(auth) <= 100),
  constraint push_subscriptions_ua check (user_agent is null or char_length(user_agent) <= 500)
);
create index push_subscriptions_employee_idx on public.push_subscriptions (employee_id);

-- Lưu / chuyển thiết bị sang người đang đăng nhập (máy dùng chung: người đăng nhập sau nhận thông báo)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_employee_id();
begin
  if v_me is null then
    raise exception 'Tài khoản không hợp lệ.' using errcode = '42501';
  end if;
  insert into public.push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 500))
  on conflict (endpoint) do update set
    employee_id = excluded.employee_id,
    p256dh      = excluded.p256dh,
    auth        = excluded.auth,
    user_agent  = excluded.user_agent,
    updated_at  = now();
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql volatile security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s
  where s.endpoint = p_endpoint and s.employee_id = private.current_employee_id()
$$;

-- ---------------------------------------------------------------------
-- 3. THÔNG BÁO TRÊN APP
-- ---------------------------------------------------------------------
create type public.notification_kind as enum ('task_due_soon', 'task_overdue', 'task_overdue_report');

create table public.notifications (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references public.employees (id) on delete cascade,
  kind             public.notification_kind not null,
  task_instance_id uuid references public.task_instances (id),
  title            text not null,
  body             text not null,
  url              text not null default '/',
  created_at       timestamptz not null default now(),
  read_at          timestamptz,
  push_sent_at     timestamptz,
  constraint notifications_once unique (employee_id, kind, task_instance_id)
);
create index notifications_employee_idx on public.notifications (employee_id, created_at desc);
create index notifications_task_idx on public.notifications (task_instance_id);
create index notifications_unpushed_idx on public.notifications (created_at) where push_sent_at is null;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications n set read_at = now()
  where n.employee_id = private.current_employee_id() and n.read_at is null
    and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. SINH THÔNG BÁO CHECKLIST (cron mỗi phút)
-- ---------------------------------------------------------------------
create or replace function private.enqueue_task_notifications()
returns integer
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_today  date := private.vn_today();
  v_before interval := interval '30 minutes';  -- báo trước hạn chót
  v_window interval := interval '6 hours';     -- chỉ báo quá hạn trong vòng 6 giờ sau hạn (tránh dồn báo cũ)
  v_total  integer := 0;
  v_count  integer;
begin
  -- Việc của hôm nay phải tồn tại kể cả khi chưa ai mở app
  perform public.ensure_task_instances(v_today);

  -- Người phụ trách: người chính; + người thay thế nếu người chính chưa chấm công hôm đó
  create temp table if not exists tmp_task_recipients (task_id uuid, employee_id uuid, stage text) on commit drop;
  truncate tmp_task_recipients;

  insert into tmp_task_recipients (task_id, employee_id, stage)
  select t.id, r.employee_id, case when now() >= t.due_at then 'overdue' else 'due_soon' end
  from public.task_instances t
  cross join lateral (
    select t.primary_employee_id as employee_id
    union
    select t.backup_employee_id
    where t.backup_employee_id is not null and not private.checked_in_on(t.primary_employee_id, t.task_date)
  ) r
  join public.employees e on e.id = r.employee_id and e.is_active
  where t.status = 'pending'
    and t.task_date between v_today - 1 and v_today
    and now() >= greatest(t.start_at, t.due_at - v_before)
    and now() < t.due_at + v_window;

  insert into public.notifications (employee_id, kind, task_instance_id, title, body, url)
  select r.employee_id,
         case r.stage when 'overdue' then 'task_overdue'::public.notification_kind else 'task_due_soon'::public.notification_kind end,
         t.id,
         case r.stage when 'overdue' then '🔴 Quá hạn: ' else '⏰ Sắp hết hạn: ' end || t.title,
         'Hạn chót ' || to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') || ' · ' || b.name
           || case r.stage when 'overdue' then ' — làm ngay hoặc báo "Không đạt" kèm lý do.' else '' end,
         '/checklist'
  from tmp_task_recipients r
  join public.task_instances t on t.id = r.task_id
  join public.branches b on b.id = t.branch_id
  on conflict (employee_id, kind, task_instance_id) do nothing;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  -- Quá hạn → báo Quản lý chi nhánh + Quản trị viên (trừ chính người phụ trách)
  insert into public.notifications (employee_id, kind, task_instance_id, title, body, url)
  select m.id, 'task_overdue_report', t.id,
         '🔴 Việc quá hạn: ' || t.title,
         p.full_name || ' · ' || b.name || ' · hạn ' || to_char(t.due_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'),
         '/checklist/manage?date=' || t.task_date
  from public.task_instances t
  join public.branches b on b.id = t.branch_id
  join public.employees p on p.id = t.primary_employee_id
  join public.employees m on m.is_active and (
    m.role = 'admin'
    or (m.role = 'manager' and exists (
      select 1 from public.employee_branches eb where eb.employee_id = m.id and eb.branch_id = t.branch_id
    ))
  )
  where t.status = 'pending'
    and t.task_date between v_today - 1 and v_today
    and now() >= t.due_at and now() < t.due_at + v_window
    and not exists (select 1 from tmp_task_recipients r where r.task_id = t.id and r.employee_id = m.id)
  on conflict (employee_id, kind, task_instance_id) do nothing;
  get diagnostics v_count = row_count;
  v_total := v_total + v_count;

  return v_total;
end;
$$;
revoke all on function private.enqueue_task_notifications() from public;

-- Gọi Edge Function (bất đồng bộ qua pg_net)
create or replace function private.call_ops_job(p_job text)
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_url    text := private.ops_secret('ops_jobs_url');
  v_secret text := private.ops_secret('ops_cron_secret');
begin
  if v_url is null or v_secret is null then
    return;  -- chưa cấu hình (chưa chạy scripts/setup-push.mjs)
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('job', p_job),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function private.call_ops_job(text) from public;

create or replace function private.run_task_reminders()
returns void
language plpgsql volatile security definer
set search_path = ''
as $$
begin
  perform private.enqueue_task_notifications();

  -- Người không có thiết bị đăng ký: chỉ hiện trong app, không cần đẩy
  update public.notifications n set push_sent_at = now()
  where n.push_sent_at is null
    and not exists (select 1 from public.push_subscriptions s where s.employee_id = n.employee_id);

  if exists (
    select 1 from public.notifications n
    where n.push_sent_at is null and n.created_at > now() - interval '1 hour'
  ) then
    perform private.call_ops_job('reminders');
  end if;
end;
$$;
revoke all on function private.run_task_reminders() from public;

-- Edge Function lấy thông báo cần đẩy (kèm thiết bị)
create or replace function public.service_pending_pushes(p_limit integer default 100)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'title', n.title, 'body', n.body, 'url', n.url, 'kind', n.kind,
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
      from public.push_subscriptions s where s.employee_id = n.employee_id
    )
  )), '[]'::jsonb)
  from (
    select * from public.notifications n
    where n.push_sent_at is null and n.created_at > now() - interval '1 hour'
    order by n.created_at
    limit least(greatest(p_limit, 1), 500)
  ) n
$$;

create or replace function public.service_finish_pushes(p_ids uuid[], p_dead_endpoints text[] default '{}')
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.notifications n set push_sent_at = now() where n.id = any (p_ids);
  delete from public.push_subscriptions s where s.endpoint = any (p_dead_endpoints);
$$;

-- ---------------------------------------------------------------------
-- 5. TỰ DỌN ẢNH CHECKLIST CŨ (giữ 3 tháng)
-- ---------------------------------------------------------------------
alter table public.task_instances add column photo_purged_at timestamptz;
create index task_instances_photo_purge_idx on public.task_instances (completed_at)
  where photo_path is not null and photo_purged_at is null;

create or replace function public.service_photos_to_purge(p_limit integer default 500)
returns table (id uuid, photo_path text)
language sql stable security definer
set search_path = ''
as $$
  select t.id, t.photo_path
  from public.task_instances t
  where t.photo_path is not null and t.photo_purged_at is null
    and coalesce(t.completed_at, t.created_at) < now() - interval '3 months'
  order by t.completed_at
  limit least(greatest(p_limit, 1), 1000)
$$;

create or replace function public.service_mark_photos_purged(p_ids uuid[])
returns void
language sql volatile security definer
set search_path = ''
as $$
  update public.task_instances t set photo_purged_at = now() where t.id = any (p_ids) and t.photo_purged_at is null
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
  ) then
    perform private.call_ops_job('cleanup');
  end if;
end;
$$;
revoke all on function private.run_daily_cleanup() from public;

-- ---------------------------------------------------------------------
-- 6. QUYỀN & RLS
-- ---------------------------------------------------------------------
revoke all on function public.service_set_secret(text, text) from public, anon, authenticated;
revoke all on function public.service_ops_config() from public, anon, authenticated;
revoke all on function public.service_pending_pushes(integer) from public, anon, authenticated;
revoke all on function public.service_finish_pushes(uuid[], text[]) from public, anon, authenticated;
revoke all on function public.service_photos_to_purge(integer) from public, anon, authenticated;
revoke all on function public.service_mark_photos_purged(uuid[]) from public, anon, authenticated;
grant execute on function public.service_set_secret(text, text) to service_role;
grant execute on function public.service_ops_config() to service_role;
grant execute on function public.service_pending_pushes(integer) to service_role;
grant execute on function public.service_finish_pushes(uuid[], text[]) to service_role;
grant execute on function public.service_photos_to_purge(integer) to service_role;
grant execute on function public.service_mark_photos_purged(uuid[]) to service_role;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

alter table public.push_subscriptions enable row level security;
alter table public.notifications enable row level security;
revoke all on public.push_subscriptions from anon;
revoke all on public.notifications from anon;
revoke insert, update, delete, truncate on public.push_subscriptions from authenticated;
revoke insert, update, delete, truncate on public.notifications from authenticated;

create policy "push_subscriptions_select_own" on public.push_subscriptions for select to authenticated
using (employee_id = (select private.current_employee_id()));
create policy "notifications_select_own" on public.notifications for select to authenticated
using (employee_id = (select private.current_employee_id()));

-- ---------------------------------------------------------------------
-- 7. LỊCH CHẠY TỰ ĐỘNG
-- ---------------------------------------------------------------------
select cron.schedule('bomyden-task-reminders', '* * * * *', 'select private.run_task_reminders()');
-- 20:00 UTC = 03:00 giờ Việt Nam
select cron.schedule('bomyden-daily-cleanup', '0 20 * * *', 'select private.run_daily_cleanup()');
