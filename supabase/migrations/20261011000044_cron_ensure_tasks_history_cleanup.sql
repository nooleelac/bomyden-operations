-- 1) Sinh việc checklist hôm nay bằng cron (thay cho việc gọi ensure_task_instances mỗi lần mở trang).
--    Chạy mỗi 10 phút (có 00:00 giờ VN = 17:00 UTC); idempotent nên chạy lại không sao.
--    Sửa / giao / nhập mẫu vẫn gọi ensure_task_instances ngay trong server action.
select cron.schedule('bomyden-ensure-tasks', '*/10 * * * *', 'select public.ensure_task_instances()');

-- 2) Dọn nhật ký chạy cron (bảng cron.job_run_details tăng ~1.450 dòng/ngày): giữ 7 ngày.
--    03:30 giờ VN = 20:30 UTC.
select cron.schedule(
  'bomyden-cron-history-cleanup',
  '30 20 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
