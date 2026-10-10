-- =====================================================================
-- KIỂM THỬ TỰ ĐỘNG CÔNG THỨC LƯƠNG (private.compute_payslip)
--
-- Chạy: npm run test:payroll  (gọi public.service_run_payroll_tests bằng secret key)
-- Cách hoạt động: tạo chi nhánh / nhân viên / chấm công / ca / đơn / checklist THỬ (tháng 01/2026),
-- tính phiếu lương và so với số tính tay; cuối cùng ném lỗi để HỦY TOÀN BỘ dữ liệu thử
-- (không ghi gì vào DB, không gửi thông báo, không hiện trên realtime).
-- Mỗi nhân viên thử có hồ sơ lương ghi rõ mọi mức phạt → không phụ thuộc cài đặt lương chung.
--
-- Sửa công thức lương → chạy lại test; đổi quy tắc tính → cập nhật số mong đợi ở đây (migration mới).
-- =====================================================================

-- Giờ Việt Nam dạng 'YYYY-MM-DD HH24:MI' → timestamptz
create or replace function private.test_ts(p text)
returns timestamptz
language sql
stable
set search_path = ''
as $$ select p::timestamp at time zone 'Asia/Ho_Chi_Minh' $$;

-- Nhân viên thử (kèm tài khoản đăng nhập tạm) + gán chi nhánh + hồ sơ lương (p_profile = null → không có hồ sơ)
create or replace function private.test_employee(
  p_branch_id uuid,
  p_profile jsonb,
  p_requires_attendance boolean default true,
  p_default_start time default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_auth uuid := gen_random_uuid();
  v_id   uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (v_auth, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'payroll-test-' || v_auth || '@test.invalid', now(), now());

  insert into public.employees (auth_user_id, full_name, email, role, requires_attendance, default_start_time)
  values (v_auth, 'NV thử lương', 'payroll-test-' || v_auth || '@test.invalid', 'staff', p_requires_attendance, p_default_start)
  returning id into v_id;

  insert into public.employee_branches (employee_id, branch_id) values (v_id, p_branch_id);

  if p_profile is not null then
    insert into public.payroll_profiles
    select * from jsonb_populate_record(null::public.payroll_profiles, jsonb_build_object(
      'employee_id', v_id,
      'pay_type', 'hourly', 'pay_period', 'weekly',
      'hourly_rate', 0, 'shift_rate', 0, 'fixed_salary', 0, 'standard_days', 26,
      'overtime_enabled', false, 'overtime_threshold_minutes', 480, 'overtime_rate', 0,
      'allowance_per_period', 0, 'allowance_per_workday', 0,
      'late_grace_minutes', 0, 'late_penalty', 0,
      'early_grace_minutes', 0, 'early_leave_penalty', 0, 'absent_penalty', 0,
      'checklist_failed_penalty', 0, 'checklist_missed_penalty', 0, 'checklist_late_penalty', 0,
      'can_view_payslip', false, 'created_at', now(), 'updated_at', now()
    ) || p_profile);
  end if;
  return v_id;
end;
$$;

-- Lượt chấm công thử (p_out = null → chưa ra ca)
create or replace function private.test_att(p_employee_id uuid, p_branch_id uuid, p_in text, p_out text default null)
returns void
language sql
set search_path = ''
as $$
  insert into public.attendance_records (employee_id, branch_id, check_in_at, check_in_method, check_out_at, check_out_method)
  values (p_employee_id, p_branch_id, private.test_ts(p_in), 'manual',
          private.test_ts(p_out), case when p_out is not null then 'manual'::public.attendance_method end)
$$;

-- Ca đã công bố
create or replace function private.test_shift(p_employee_id uuid, p_branch_id uuid, p_date date, p_start time, p_end time)
returns uuid
language sql
set search_path = ''
as $$
  insert into public.shifts (branch_id, employee_id, work_date, start_time, end_time, start_at, end_at, status)
  values (p_branch_id, p_employee_id, p_date, p_start, p_end, now(), now(), 'published')
  returning id
$$;

-- Đơn xin phép (nghỉ: p_start..p_end; đi trễ / về sớm: p_shift_id + p_time)
create or replace function private.test_request(
  p_employee_id uuid, p_branch_id uuid, p_kind public.request_kind, p_status public.request_status,
  p_start date default null, p_end date default null, p_shift_id uuid default null, p_time time default null,
  p_paid boolean default false
)
returns void
language sql
set search_path = ''
as $$
  insert into public.schedule_requests (employee_id, branch_id, kind, status, start_date, end_date, shift_id, requested_time, is_paid, reason)
  values (p_employee_id, p_branch_id, p_kind, p_status, p_start, p_end, p_shift_id, p_time, p_paid, 'Kiểm thử lương')
$$;

-- Việc checklist (mỗi việc 1 mẫu riêng, mẫu tắt + chưa giao → cron không sinh thêm)
create or replace function private.test_task(
  p_branch_id uuid, p_date date, p_start time, p_due time,
  p_primary uuid, p_backup uuid, p_by_shift boolean, p_status public.task_status,
  p_completed_by uuid default null, p_completed_at text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_template uuid;
begin
  insert into public.task_templates (branch_id, title, category, start_time, due_time, is_active)
  values (p_branch_id, 'Việc thử ' || gen_random_uuid(), 'Kiểm thử', p_start, p_due, false)
  returning id into v_template;

  insert into public.task_instances (
    template_id, branch_id, task_date, title, category, priority, start_at, due_at, requires_photo, requires_note,
    by_shift, primary_employee_id, backup_employee_id, status, completed_by, completed_at
  )
  values (
    v_template, p_branch_id, p_date, 'Việc thử', 'Kiểm thử', 'normal',
    (p_date + p_start) at time zone 'Asia/Ho_Chi_Minh', (p_date + p_due) at time zone 'Asia/Ho_Chi_Minh', false, false,
    p_by_shift, p_primary, p_backup, p_status, p_completed_by, private.test_ts(p_completed_at)
  );
end;
$$;

-- So sánh 1 giá trị → 1 dòng kết quả
create or replace function private.test_eq(p_case text, p_check text, p_actual text, p_expected text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(jsonb_build_object(
    'case', p_case, 'check', p_check,
    'ok', p_actual is not distinct from p_expected,
    'actual', p_actual, 'expected', p_expected
  ))
$$;

-- Tổng tiền các dòng có mã p_code trong phiếu (null nếu không có dòng)
create or replace function private.test_line(p_slip jsonb, p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select sum((l ->> 'amount')::bigint)::text from jsonb_array_elements(p_slip -> 'lines') l where l ->> 'code' = p_code
$$;

-- Số cảnh báo chặn chốt
create or replace function private.test_blocking(p_slip jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select count(*)::text from jsonb_array_elements(p_slip -> 'warnings') w where (w ->> 'blocking')::boolean
$$;

-- ---------------------------------------------------------------------
-- Bộ test. Tuần thử: T2 05/01/2026 – CN 11/01/2026. Tháng thử: 01/2026.
-- ---------------------------------------------------------------------
create or replace function private.payroll_test_suite()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r      jsonb := '[]';
  b      uuid;
  e      uuid;
  e2     uuid;
  s1     uuid;
  s3     uuid;
  v      jsonb;
  c      text;
  wk     constant date := '2026-01-05';
  mo     constant date := '2026-01-01';
  d      integer;
begin
  insert into public.branches (name) values ('Chi nhánh kiểm thử lương') returning id into b;

  -- 1. Theo giờ: cộng phút nhiều ngày, ca qua đêm tính cho ngày vào ca, bỏ lượt ngoài kỳ, làm tròn 1.000đ
  c := '01 Theo giờ + ca qua đêm + làm tròn';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":30000}');
    perform private.test_att(e, b, '2026-01-05 08:00', '2026-01-05 12:00');  -- 240'
    perform private.test_att(e, b, '2026-01-06 13:00', '2026-01-06 18:01');  -- 301'
    perform private.test_att(e, b, '2026-01-07 22:00', '2026-01-08 02:00');  -- 240' (qua đêm → ngày 07)
    perform private.test_att(e, b, '2026-01-12 08:00', '2026-01-12 09:00');  -- tuần sau → không tính
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số phút làm', v ->> 'worked_minutes', '781')
           || private.test_eq(c, 'Số ngày công', v ->> 'work_days', '3')
           || private.test_eq(c, 'Lương theo giờ', private.test_line(v, 'base'), '390500')
           || private.test_eq(c, 'Thực nhận (làm tròn 390.500 → 391.000)', v ->> 'net_amount', '391000')
           || private.test_eq(c, 'Được chốt', v ->> 'can_finalize', 'true');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 2. Tăng ca: giờ vượt chuẩn tính theo từng NGÀY (cộng mọi lượt trong ngày)
  c := '02 Tăng ca theo ngày';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":30000,"overtime_enabled":true,"overtime_threshold_minutes":480,"overtime_rate":45000}');
    perform private.test_att(e, b, '2026-01-05 08:00', '2026-01-05 18:00');  -- 600' → tăng ca 120'
    perform private.test_att(e, b, '2026-01-06 08:00', '2026-01-06 12:00');  -- 240'
    perform private.test_att(e, b, '2026-01-06 13:00', '2026-01-06 18:00');  -- 300' → ngày 540', tăng ca 60'
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Phút tăng ca', v ->> 'overtime_minutes', '180')
           || private.test_eq(c, 'Lương giờ thường (960'')', private.test_line(v, 'base'), '480000')
           || private.test_eq(c, 'Tiền tăng ca (180'' × 45.000)', private.test_line(v, 'overtime'), '135000')
           || private.test_eq(c, 'Tổng thu nhập', v ->> 'gross_amount', '615000');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 3. Theo ca + phụ cấp cố định/kỳ + phụ cấp theo ngày công
  c := '03 Theo ca + phụ cấp';
  begin
    e := private.test_employee(b, '{"pay_type":"per_shift","shift_rate":200000,"allowance_per_period":100000,"allowance_per_workday":20000}');
    perform private.test_att(e, b, '2026-01-05 08:00', '2026-01-05 11:00');
    perform private.test_att(e, b, '2026-01-05 17:00', '2026-01-05 21:00');
    perform private.test_att(e, b, '2026-01-06 08:00', '2026-01-06 12:00');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số ca', v ->> 'shifts', '3')
           || private.test_eq(c, 'Lương theo ca', private.test_line(v, 'base'), '600000')
           || private.test_eq(c, 'Phụ cấp cố định', private.test_line(v, 'allowance_period'), '100000')
           || private.test_eq(c, 'Phụ cấp theo ngày (2 ngày)', private.test_line(v, 'allowance_daily'), '40000')
           || private.test_eq(c, 'Thực nhận', v ->> 'net_amount', '740000');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 4. Cố định theo tháng + nghỉ có lương (ngày nghỉ trùng ngày đi làm không tính 2 lần; nghỉ không lương không tính)
  c := '04 Cố định + nghỉ có lương';
  begin
    e := private.test_employee(b, '{"pay_type":"fixed","pay_period":"monthly","fixed_salary":7800000,"standard_days":26}', false);
    for d in 2..21 loop  -- 20 ngày đi làm (02–21/01)
      perform private.test_att(e, b, format('2026-01-%s 08:00', lpad(d::text, 2, '0')), format('2026-01-%s 16:00', lpad(d::text, 2, '0')));
    end loop;
    perform private.test_request(e, b, 'leave', 'approved', '2026-01-21', '2026-01-23', p_paid => true);   -- 21 đã đi làm → 2 ngày
    perform private.test_request(e, b, 'leave', 'approved', '2026-01-24', '2026-01-24', p_paid => false);  -- không lương
    perform private.test_request(e, b, 'leave', 'rejected', '2026-01-26', '2026-01-26', p_paid => true);   -- bị từ chối
    v := private.compute_payslip(e, mo);
    r := r || private.test_eq(c, 'Ngày công', v ->> 'work_days', '20')
           || private.test_eq(c, 'Ngày nghỉ có lương', v ->> 'paid_leave_days', '2')
           || private.test_eq(c, 'Lương cố định (22/26 × 7,8tr)', private.test_line(v, 'base'), '6600000')
           || private.test_eq(c, 'Kỳ kết thúc', v ->> 'period_end', '2026-01-31');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 5. Cố định: làm vượt ngày công chuẩn vẫn không quá mức lương
  c := '05 Cố định không vượt mức lương';
  begin
    e := private.test_employee(b, '{"pay_type":"fixed","fixed_salary":5200000,"standard_days":4}', false);
    for d in 5..9 loop
      perform private.test_att(e, b, format('2026-01-%s 08:00', lpad(d::text, 2, '0')), format('2026-01-%s 12:00', lpad(d::text, 2, '0')));
    end loop;
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Ngày công', v ->> 'work_days', '5')
           || private.test_eq(c, 'Lương (trần = 5,2tr)', private.test_line(v, 'base'), '5200000');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 6. Đi trễ: so với ca theo lịch (có ân hạn), đơn đi trễ đã duyệt dời mốc, không có ca → giờ vào ca mặc định
  c := '06 Phạt đi trễ';
  begin
    e := private.test_employee(b, '{"pay_type":"per_shift","shift_rate":100000,"late_grace_minutes":10,"late_penalty":50000}', true, '09:00');
    perform private.test_shift(e, b, '2026-01-05', '08:00', '12:00');
    perform private.test_shift(e, b, '2026-01-06', '08:00', '12:00');
    s3 := private.test_shift(e, b, '2026-01-07', '08:00', '12:00');
    perform private.test_request(e, b, 'late', 'approved', p_shift_id => s3, p_time => '08:30');
    perform private.test_att(e, b, '2026-01-05 08:11', '2026-01-05 12:00');  -- trễ 11' > 10' → phạt
    perform private.test_att(e, b, '2026-01-06 08:10', '2026-01-06 12:00');  -- đúng 10' ân hạn → không phạt
    perform private.test_att(e, b, '2026-01-07 08:25', '2026-01-07 12:00');  -- đã xin trễ đến 08:30 → không phạt
    perform private.test_att(e, b, '2026-01-08 09:15', '2026-01-08 12:00');  -- không có ca, mặc định 09:00 → phạt
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số lần trễ', v ->> 'late_count', '2')
           || private.test_eq(c, 'Tiền phạt trễ', private.test_line(v, 'penalty_late'), '-100000')
           || private.test_eq(c, 'Không bị tính nghỉ / về sớm', (v ->> 'absent_count') || '/' || (v ->> 'early_count'), '0/0')
           || private.test_eq(c, 'Thực nhận', v ->> 'net_amount', '300000');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 7. Về sớm: so với giờ kết thúc ca (có ân hạn); đơn về sớm đã duyệt dời mốc
  c := '07 Phạt về sớm';
  begin
    e := private.test_employee(b, '{"pay_type":"per_shift","shift_rate":100000,"early_grace_minutes":5,"early_leave_penalty":30000}');
    perform private.test_shift(e, b, '2026-01-05', '08:00', '12:00');
    perform private.test_shift(e, b, '2026-01-06', '08:00', '12:00');
    s3 := private.test_shift(e, b, '2026-01-07', '08:00', '12:00');
    perform private.test_request(e, b, 'early_leave', 'approved', p_shift_id => s3, p_time => '11:00');
    perform private.test_att(e, b, '2026-01-05 08:00', '2026-01-05 11:50');  -- sớm 10' > 5' → phạt
    perform private.test_att(e, b, '2026-01-06 08:00', '2026-01-06 11:56');  -- sớm 4' → không phạt
    perform private.test_att(e, b, '2026-01-07 08:00', '2026-01-07 11:00');  -- đã xin về 11:00 → không phạt
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số lần về sớm', v ->> 'early_count', '1')
           || private.test_eq(c, 'Tiền phạt về sớm', private.test_line(v, 'penalty_early'), '-30000')
           || private.test_eq(c, 'Không trễ (vào đúng 08:00)', v ->> 'late_count', '0')
           || private.test_eq(c, 'Thực nhận', v ->> 'net_amount', '270000');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 8. Nghỉ không phép: ca đã qua mà không chấm công và không có đơn nghỉ được duyệt; NV không cần chấm công thì không phạt
  c := '08 Phạt nghỉ không phép';
  begin
    e := private.test_employee(b, '{"pay_type":"per_shift","shift_rate":100000,"absent_penalty":100000}');
    e2 := private.test_employee(b, '{"pay_type":"per_shift","shift_rate":100000,"absent_penalty":100000}', false);
    foreach s1 in array array[e, e2] loop
      perform private.test_shift(s1, b, '2026-01-05', '08:00', '12:00');
      perform private.test_shift(s1, b, '2026-01-06', '08:00', '12:00');
      perform private.test_shift(s1, b, '2026-01-07', '08:00', '12:00');
      perform private.test_att(s1, b, '2026-01-05 08:00', '2026-01-05 12:00');
      perform private.test_request(s1, b, 'leave', 'approved', '2026-01-06', '2026-01-06');  -- nghỉ có đơn (không lương)
    end loop;
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số ca nghỉ không phép', v ->> 'absent_count', '1')
           || private.test_eq(c, 'Tiền phạt', private.test_line(v, 'penalty_absent'), '-100000')
           || private.test_eq(c, 'Thực nhận', v ->> 'net_amount', '0');
    v := private.compute_payslip(e2, wk);
    r := r || private.test_eq(c, 'NV không cần chấm công: không phạt', v ->> 'absent_count', '0')
           || private.test_eq(c, 'NV không cần chấm công: thực nhận', v ->> 'net_amount', '100000');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 9. Checklist: không đạt / làm trễ (người đánh dấu); không làm → người chính, hoặc người thay nếu người chính nghỉ;
  --    việc giao theo ca → người có ca trùng giờ. Thực nhận âm → cảnh báo (không chặn chốt).
  c := '09 Phạt checklist';
  begin
    e  := private.test_employee(b, '{"pay_type":"per_shift","shift_rate":100000,"checklist_failed_penalty":20000,"checklist_late_penalty":10000,"checklist_missed_penalty":50000}');
    e2 := private.test_employee(b, '{"checklist_missed_penalty":50000}');
    perform private.test_att(e, b, '2026-01-06 08:00', '2026-01-06 12:00');  -- A đi làm 06, nghỉ 07
    perform private.test_shift(e2, b, '2026-01-08', '08:00', '12:00');       -- B có ca 08 (không chấm công)
    perform private.test_task(b, '2026-01-05', '08:00', '10:00', e, null, false, 'failed', e, '2026-01-05 09:30');
    perform private.test_task(b, '2026-01-05', '08:00', '10:00', e, null, false, 'done', e, '2026-01-05 10:30');   -- trễ
    perform private.test_task(b, '2026-01-06', '08:00', '10:00', e, null, false, 'done', e, '2026-01-06 09:00');   -- đúng hạn
    perform private.test_task(b, '2026-01-06', '08:00', '10:00', e, e2, false, 'pending');      -- A đi làm → A chịu
    perform private.test_task(b, '2026-01-07', '08:00', '10:00', e, e2, false, 'pending');      -- A nghỉ → B chịu
    perform private.test_task(b, '2026-01-07', '08:00', '10:00', e, null, false, 'cancelled');  -- đã hủy → không tính
    perform private.test_task(b, '2026-01-08', '10:00', '11:00', null, null, true, 'pending');  -- theo ca → B chịu
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'A: phạt không đạt', private.test_line(v, 'penalty_task_failed'), '-20000')
           || private.test_eq(c, 'A: phạt làm trễ', private.test_line(v, 'penalty_task_late'), '-10000')
           || private.test_eq(c, 'A: phạt không làm (1 việc)', private.test_line(v, 'penalty_task_missed'), '-50000')
           || private.test_eq(c, 'A: thực nhận', v ->> 'net_amount', '20000');
    v := private.compute_payslip(e2, wk);
    r := r || private.test_eq(c, 'B: phạt không làm (làm thay + theo ca)', private.test_line(v, 'penalty_task_missed'), '-100000')
           || private.test_eq(c, 'B: thực nhận âm', v ->> 'net_amount', '-100000')
           || private.test_eq(c, 'B: vẫn được chốt', v ->> 'can_finalize', 'true');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 10. Điều chỉnh tay + ứng lương (chỉ trừ đơn đã duyệt; đơn chờ duyệt chặn chốt)
  c := '10 Điều chỉnh + ứng lương';
  begin
    e := private.test_employee(b, '{"pay_type":"per_shift","shift_rate":500000}');
    perform private.test_att(e, b, '2026-01-05 08:00', '2026-01-05 12:00');
    insert into public.payroll_adjustments (employee_id, period_start, kind, amount, reason) values
      (e, wk, 'kpi', 200000, 'Kiểm thử'), (e, wk, 'bonus', 50000, 'Kiểm thử'), (e, wk, 'allowance', 30000, 'Kiểm thử'),
      (e, wk, 'deduction', 40000, 'Kiểm thử'), (e, wk, 'correction_plus', 10000, 'Kiểm thử'),
      (e, wk, 'correction_minus', 5000, 'Kiểm thử'),
      (e, '2026-01-12', 'bonus', 999000, 'Kỳ sau → không tính');
    insert into public.salary_advances (employee_id, period_start, amount, status) values
      (e, wk, 300000, 'approved'), (e, wk, 100000, 'rejected');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Tổng thu nhập', v ->> 'gross_amount', '790000')
           || private.test_eq(c, 'Tổng khoản trừ (gồm ứng)', v ->> 'deductions_amount', '345000')
           || private.test_eq(c, 'Tiền đã ứng', v ->> 'advance_amount', '300000')
           || private.test_eq(c, 'Thực nhận', v ->> 'net_amount', '445000')
           || private.test_eq(c, 'Được chốt', v ->> 'can_finalize', 'true');
    insert into public.salary_advances (employee_id, period_start, amount, status) values (e, wk, 50000, 'pending');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Đơn ứng chờ duyệt → chặn chốt', v ->> 'can_finalize', 'false')
           || private.test_eq(c, 'Đơn chờ duyệt chưa bị trừ', v ->> 'net_amount', '445000');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 11. Chốt sớm (nghỉ việc giữa kỳ): chỉ tính đến ngày chốt, báo số lượt chấm công bị bỏ
  c := '11 Chốt sớm giữa kỳ';
  begin
    e := private.test_employee(b, '{"pay_type":"fixed","pay_period":"monthly","fixed_salary":2600000,"standard_days":26}', false);
    for d in 2..11 loop
      perform private.test_att(e, b, format('2026-01-%s 08:00', lpad(d::text, 2, '0')), format('2026-01-%s 16:00', lpad(d::text, 2, '0')));
    end loop;
    perform private.test_att(e, b, '2026-01-20 08:00', '2026-01-20 16:00');
    v := private.compute_payslip(e, mo, '2026-01-15');
    r := r || private.test_eq(c, 'Ngày công đến 15/01', v ->> 'work_days', '10')
           || private.test_eq(c, 'Lương (10/26 × 2,6tr)', private.test_line(v, 'base'), '1000000')
           || private.test_eq(c, 'Đánh dấu chốt sớm', v ->> 'closed_early', 'true')
           || private.test_eq(c, 'Có cảnh báo lượt bị bỏ (không chặn)',
                (select count(*)::text from jsonb_array_elements(v -> 'warnings') w where w ->> 'message' like 'Có 1 lượt chấm công sau ngày 15/01%'), '1')
           || private.test_eq(c, 'Được chốt', v ->> 'can_finalize', 'true');
    v := private.compute_payslip(e, mo);
    r := r || private.test_eq(c, 'Cả tháng: 11 ngày công', private.test_line(v, 'base'), '1100000');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 12. Chặn chốt: còn ca chưa ra ca + còn đơn chờ duyệt; ca chưa ra không được tính giờ
  c := '12 Cảnh báo chặn chốt';
  begin
    e := private.test_employee(b, '{"pay_type":"hourly","hourly_rate":30000}');
    perform private.test_att(e, b, '2026-01-05 08:00', null);
    perform private.test_request(e, b, 'leave', 'pending', '2026-01-06', '2026-01-06');
    v := private.compute_payslip(e, wk);
    r := r || private.test_eq(c, 'Số cảnh báo chặn chốt', private.test_blocking(v), '2')
           || private.test_eq(c, 'Không được chốt', v ->> 'can_finalize', 'false')
           || private.test_eq(c, 'Ca chưa ra không tính giờ', v ->> 'worked_minutes', '0');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 13. Ngày bắt đầu kỳ sai (lương tháng phải bắt đầu ngày 01) → báo lỗi
  c := '13 Ngày bắt đầu kỳ sai';
  begin
    e := private.test_employee(b, '{"pay_period":"monthly"}');
    begin
      v := private.compute_payslip(e, '2026-01-02');
      r := r || private.test_eq(c, 'Phải báo lỗi', 'không báo lỗi', 'báo lỗi');
    exception when others then
      r := r || private.test_eq(c, 'Phải báo lỗi', 'báo lỗi', 'báo lỗi');
    end;
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  -- 14. Không có hồ sơ lương → không có phiếu
  c := '14 Không có hồ sơ lương';
  begin
    e := private.test_employee(b, null);
    r := r || private.test_eq(c, 'Kết quả rỗng', coalesce(private.compute_payslip(e, wk)::text, 'null'), 'null');
  exception when others then r := r || private.test_eq(c, 'Lỗi', sqlerrm, null);
  end;

  return r;
end;
$$;

-- Chạy bộ test rồi hủy toàn bộ dữ liệu thử. Chỉ server (secret key) gọi được.
create or replace function public.service_run_payroll_tests()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_results jsonb := '[]'::jsonb;
begin
  begin
    v_results := private.payroll_test_suite();
    raise exception 'Hủy dữ liệu kiểm thử' using errcode = 'PTRBK';
  exception when sqlstate 'PTRBK' then
    null;  -- dữ liệu thử đã bị hủy; biến kết quả vẫn giữ
  end;
  return v_results;
end;
$$;

revoke all on function private.test_ts(text) from public;
revoke all on function private.test_employee(uuid, jsonb, boolean, time) from public;
revoke all on function private.test_att(uuid, uuid, text, text) from public;
revoke all on function private.test_shift(uuid, uuid, date, time, time) from public;
revoke all on function private.test_request(uuid, uuid, public.request_kind, public.request_status, date, date, uuid, time, boolean) from public;
revoke all on function private.test_task(uuid, date, time, time, uuid, uuid, boolean, public.task_status, uuid, text) from public;
revoke all on function private.test_eq(text, text, text, text) from public;
revoke all on function private.test_line(jsonb, text) from public;
revoke all on function private.test_blocking(jsonb) from public;
revoke all on function private.payroll_test_suite() from public;
revoke all on function public.service_run_payroll_tests() from public, anon, authenticated;
grant execute on function public.service_run_payroll_tests() to service_role;
