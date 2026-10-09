-- Hạn chót đăng ký ca 2 ngày + nhắc vào Thứ Bảy 15:00 giờ VN (08:00 UTC) — 10/10/2026
-- Nhắc T7, hạn 2 ngày → NV đăng ký được trọn tuần tới từ thứ Hai.
update public.schedule_settings set register_deadline_days = 2 where id;
select cron.alter_job((select jobid from cron.job where jobname = 'bomyden-registration-reminder'), schedule := '0 8 * * 6');
