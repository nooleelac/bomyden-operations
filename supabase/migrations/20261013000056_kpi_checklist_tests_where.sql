-- Sửa bộ test KPI trên DB đã chạy migration 55 bản đầu: UPDATE cài đặt phải có WHERE (pg_safeupdate).
-- Migration 55 hiện tại đã có sẵn WHERE → trên DB mới, các replace dưới đây không đổi gì.
do $do$
declare v text;
begin
  select pg_get_functiondef('private.payroll_test_suite_kpi()'::regprocedure) into v;
  execute replace(v, 'kpi_checklist_target_percent = 90;', 'kpi_checklist_target_percent = 90 where id;');
  select pg_get_functiondef('public.service_run_payroll_tests()'::regprocedure) into v;
  execute replace(v, 'set kpi_checklist_bonus = 0;', 'set kpi_checklist_bonus = 0 where id;');
end $do$;
