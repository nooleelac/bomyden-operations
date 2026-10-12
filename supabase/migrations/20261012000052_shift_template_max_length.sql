-- Mẫu ca đang dùng dài tối đa 16 tiếng (giống ca làm). NOT VALID: mẫu cũ sai giờ vẫn giữ để QTV/QL tự sửa,
-- mọi lần tạo / sửa từ nay đều bị kiểm tra. Mẫu đã ngừng dùng (is_active = false) không bị chặn → vẫn ẩn / xóa được mẫu sai.
alter table public.shift_templates add constraint shift_templates_duration
  check (start_time = end_time or private.time_span_minutes(start_time, end_time) <= 960) not valid;

-- (migration shift_template_max_length_active_only)
alter table public.shift_templates drop constraint shift_templates_duration;
alter table public.shift_templates add constraint shift_templates_duration
  check (not is_active or start_time = end_time or private.time_span_minutes(start_time, end_time) <= 960) not valid;

-- (migration shift_template_max_length_validate) — sau khi đã sửa hết mẫu sai giờ
alter table public.shift_templates validate constraint shift_templates_duration;
