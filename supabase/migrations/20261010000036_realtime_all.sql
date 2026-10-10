-- =====================================================================
-- REALTIME CHO MỌI HOẠT ĐỘNG (10/10/2026)
-- =====================================================================
--   * Phát thay đổi của mọi bảng nghiệp vụ (trừ audit_logs, push_subscriptions — nội bộ).
--   * RLS áp cho từng người nghe → chỉ nhận dòng mình được xem (bảng nào cũng đã bật RLS).
--   * App (components/LiveSync) chỉ tải lại trang khi bảng thay đổi liên quan tới trang đang mở.
-- =====================================================================

alter publication supabase_realtime add table
  public.attendance_corrections,
  public.branches,
  public.employee_branches,
  public.employees,
  public.inventory_aliases,
  public.inventory_item_units,
  public.inventory_items,
  public.invoice_scans,
  public.payroll_adjustments,
  public.payroll_profiles,
  public.payroll_settings,
  public.payslips,
  public.salary_advances,
  public.schedule_requests,
  public.schedule_settings,
  public.shift_registrations,
  public.shift_templates,
  public.shifts,
  public.stock_balances,
  public.stock_count_lines,
  public.stock_counts,
  public.stock_issue_lines,
  public.stock_issues,
  public.stock_movements,
  public.stock_receipt_lines,
  public.stock_receipts,
  public.supplier_payments,
  public.suppliers,
  public.task_sets,
  public.task_templates;
