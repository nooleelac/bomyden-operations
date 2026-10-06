-- Index cho các khóa ngoại (theo gợi ý Supabase performance advisor)
create index if not exists audit_logs_actor_employee_idx on public.audit_logs (actor_employee_id);
create index if not exists employees_created_by_idx      on public.employees (created_by);
create index if not exists employees_updated_by_idx      on public.employees (updated_by);
create index if not exists employees_deactivated_by_idx  on public.employees (deactivated_by);
