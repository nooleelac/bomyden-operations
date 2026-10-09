// FILE SINH TỰ ĐỘNG từ Supabase (project bomyden-ops-ver4). Không sửa tay phần Database.
// Sinh lại sau mỗi migration:
//   npx supabase gen types typescript --project-id vhpbycdbprppxpejtkiu > lib/database.types.ts
// (rồi thêm lại các alias ở cuối file)

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type AttendanceRecordRow = {
  branch_id: string
  check_in_accuracy_m: number | null
  check_in_at: string
  check_in_distance_m: number | null
  check_in_ip: unknown
  check_in_lat: number | null
  check_in_lng: number | null
  check_in_method: Database["public"]["Enums"]["attendance_method"]
  check_out_accuracy_m: number | null
  check_out_at: string | null
  check_out_distance_m: number | null
  check_out_ip: unknown
  check_out_lat: number | null
  check_out_lng: number | null
  check_out_method: Database["public"]["Enums"]["attendance_method"] | null
  correction_note: string | null
  created_at: string
  employee_id: string
  id: string
  is_corrected: boolean
  last_corrected_at: string | null
  last_corrected_by: string | null
  updated_at: string
}

type AttendanceCorrectionRow = {
  applied_check_in_at: string | null
  applied_check_out_at: string | null
  attendance_id: string
  branch_id: string
  created_at: string
  employee_id: string
  id: string
  reason: string
  requested_check_in_at: string
  requested_check_out_at: string
  review_note: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  status: Database["public"]["Enums"]["correction_status"]
  updated_at: string
}

type TaskTemplateRow = {
  backup_employee_id: string | null
  branch_id: string
  category: string
  created_at: string
  created_by: string | null
  description: string | null
  due_time: string
  frequency: Database["public"]["Enums"]["task_frequency"]
  id: string
  is_active: boolean
  month_days: number[]
  primary_employee_id: string
  priority: Database["public"]["Enums"]["task_priority"]
  requires_note: boolean
  requires_photo: boolean
  sort_order: number
  start_time: string
  title: string
  updated_at: string
  updated_by: string | null
  weekdays: number[]
}

type TaskInstanceRow = {
  backup_employee_id: string | null
  branch_id: string
  category: string
  completed_at: string | null
  completed_by: string | null
  created_at: string
  description: string | null
  due_at: string
  id: string
  note: string | null
  photo_path: string | null
  photo_purged_at: string | null
  primary_employee_id: string
  priority: Database["public"]["Enums"]["task_priority"]
  reopen_reason: string | null
  reopened_at: string | null
  reopened_by: string | null
  requires_note: boolean
  requires_photo: boolean
  start_at: string
  status: Database["public"]["Enums"]["task_status"]
  task_date: string
  template_id: string
  title: string
  updated_at: string
}

type PayrollProfileRow = {
  employee_id: string
  pay_type: Database["public"]["Enums"]["pay_type"]
  pay_period: Database["public"]["Enums"]["pay_period"]
  hourly_rate: number
  shift_rate: number
  fixed_salary: number
  standard_days: number
  overtime_enabled: boolean
  overtime_threshold_minutes: number
  overtime_rate: number
  allowance_per_period: number
  allowance_per_workday: number
  late_grace_minutes: number | null
  late_penalty: number | null
  checklist_failed_penalty: number | null
  checklist_missed_penalty: number | null
  checklist_late_penalty: number | null
  early_grace_minutes: number | null
  early_leave_penalty: number | null
  absent_penalty: number | null
  can_view_payslip: boolean
  created_at: string
  updated_at: string
  updated_by: string | null
}

type PayrollSettingsRow = {
  id: boolean
  late_grace_minutes: number
  late_penalty: number
  checklist_failed_penalty: number
  checklist_missed_penalty: number
  checklist_late_penalty: number
  early_grace_minutes: number
  early_leave_penalty: number
  absent_penalty: number
  advance_max_percent: number
  updated_at: string
  updated_by: string | null
}

type NotificationRow = {
  id: string
  employee_id: string
  kind: Database["public"]["Enums"]["notification_kind"]
  task_instance_id: string | null
  ref_id: string | null
  title: string
  body: string
  url: string
  created_at: string
  read_at: string | null
  push_sent_at: string | null
}

type PushSubscriptionRow = {
  id: string
  employee_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  updated_at: string
}

type ScheduleSettingsRow = {
  id: boolean
  leave_notice_hours: number
  late_notice_hours: number
  early_notice_hours: number
  swap_notice_hours: number
  leave_days_per_month: number
  late_per_month: number
  early_per_month: number
  swap_per_month: number
  register_deadline_days: number
  updated_at: string
  updated_by: string | null
}

type ShiftTemplateRow = {
  id: string
  branch_id: string
  name: string
  start_time: string
  end_time: string
  is_active: boolean
  sort_order: number
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

type ShiftRow = {
  id: string
  branch_id: string
  employee_id: string
  work_date: string
  start_time: string
  end_time: string
  start_at: string
  end_at: string
  template_id: string | null
  note: string | null
  status: Database["public"]["Enums"]["shift_status"]
  published_at: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancel_reason: string | null
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

type ScheduleRequestRow = {
  id: string
  employee_id: string
  kind: Database["public"]["Enums"]["request_kind"]
  branch_id: string | null
  start_date: string | null
  end_date: string | null
  shift_id: string | null
  requested_time: string | null
  target_employee_id: string | null
  target_shift_id: string | null
  reason: string
  is_urgent: boolean
  over_limit: boolean
  status: Database["public"]["Enums"]["request_status"]
  peer_responded_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  is_paid: boolean
  created_at: string
  updated_at: string
}

type PayrollAdjustmentRow = {
  id: string
  employee_id: string
  period_start: string
  kind: Database["public"]["Enums"]["payroll_adjustment_kind"]
  amount: number
  reason: string
  created_at: string
  created_by: string | null
}

type PayslipRow = {
  id: string
  employee_id: string
  pay_period: Database["public"]["Enums"]["pay_period"]
  period_start: string
  period_end: string
  gross_amount: number
  deductions_amount: number
  net_amount: number
  data: Json
  finalized_at: string
  finalized_by: string | null
}

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      attendance_corrections: {
        Row: AttendanceCorrectionRow
        Insert: {
          applied_check_in_at?: string | null
          applied_check_out_at?: string | null
          attendance_id: string
          branch_id: string
          created_at?: string
          employee_id: string
          id?: string
          reason: string
          requested_check_in_at: string
          requested_check_out_at: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["correction_status"]
          updated_at?: string
        }
        Update: Partial<AttendanceCorrectionRow>
        Relationships: [
          {
            foreignKeyName: "attendance_corrections_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "attendance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_corrections_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: AttendanceRecordRow
        Insert: Partial<AttendanceRecordRow> & {
          branch_id: string
          check_in_at: string
          check_in_method: Database["public"]["Enums"]["attendance_method"]
          employee_id: string
        }
        Update: Partial<AttendanceRecordRow>
        Relationships: [
          {
            foreignKeyName: "attendance_records_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_last_corrected_by_fkey"
            columns: ["last_corrected_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_auth_uid: string | null
          actor_employee_id: string | null
          created_at: string
          id: number
          new_data: Json | null
          note: string | null
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_auth_uid?: string | null
          actor_employee_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          note?: string | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_auth_uid?: string | null
          actor_employee_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          note?: string | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_employee_id_fkey"
            columns: ["actor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          latitude: number | null
          longitude: number | null
          name: string
          radius_m: number
          updated_at: string
          updated_by: string | null
          wifi_ips: unknown[]
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          radius_m?: number
          updated_at?: string
          updated_by?: string | null
          wifi_ips?: unknown[]
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          radius_m?: number
          updated_at?: string
          updated_by?: string | null
          wifi_ips?: unknown[]
        }
        Relationships: [
          {
            foreignKeyName: "branches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branches_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_branches: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          employee_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_branches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_branches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          auth_user_id: string
          created_at: string
          created_by: string | null
          deactivated_at: string | null
          deactivated_by: string | null
          default_start_time: string | null
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          requires_attendance: boolean
          can_manage_payroll: boolean
          can_receive_stock: boolean
          self_schedule: boolean
          role: Database["public"]["Enums"]["employee_role"]
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          default_start_time?: string | null
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          phone?: string | null
          requires_attendance?: boolean
          can_manage_payroll?: boolean
          can_receive_stock?: boolean
          self_schedule?: boolean
          role?: Database["public"]["Enums"]["employee_role"]
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          created_by?: string | null
          deactivated_at?: string | null
          deactivated_by?: string | null
          default_start_time?: string | null
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          requires_attendance?: boolean
          can_manage_payroll?: boolean
          can_receive_stock?: boolean
          self_schedule?: boolean
          role?: Database["public"]["Enums"]["employee_role"]
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_deactivated_by_fkey"
            columns: ["deactivated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_settings: {
        Row: PayrollSettingsRow
        Insert: never
        Update: Partial<Omit<PayrollSettingsRow, "id">>
        Relationships: []
      }
      notifications: {
        Row: NotificationRow
        Insert: never
        Update: never
        Relationships: []
      }
      push_subscriptions: {
        Row: PushSubscriptionRow
        Insert: never
        Update: never
        Relationships: []
      }
      schedule_settings: {
        Row: ScheduleSettingsRow
        Insert: never
        Update: Partial<Omit<ScheduleSettingsRow, "id">>
        Relationships: []
      }
      shift_templates: {
        Row: ShiftTemplateRow
        Insert: { branch_id: string; name: string; start_time: string; end_time: string; is_active?: boolean; sort_order?: number }
        Update: Partial<Pick<ShiftTemplateRow, "name" | "start_time" | "end_time" | "is_active" | "sort_order">>
        Relationships: [
          {
            foreignKeyName: "shift_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_registrations: {
        Row: {
          id: string
          branch_id: string
          employee_id: string
          work_date: string
          template_id: string | null
          status: Database["public"]["Enums"]["registration_status"]
          shift_id: string | null
          review_note: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      shifts: {
        Row: ShiftRow
        Insert: {
          branch_id: string
          employee_id: string
          work_date: string
          start_time: string
          end_time: string
          template_id?: string | null
          note?: string | null
          status?: Database["public"]["Enums"]["shift_status"]
          // Tính bởi trigger
          start_at?: string
          end_at?: string
        }
        Update: Partial<Pick<ShiftRow, "employee_id" | "work_date" | "start_time" | "end_time" | "template_id" | "note" | "status" | "cancel_reason">>
        Relationships: [
          {
            foreignKeyName: "shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_requests: {
        Row: ScheduleRequestRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "schedule_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_target_employee_id_fkey"
            columns: ["target_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_target_shift_id_fkey"
            columns: ["target_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_profiles: {
        Row: PayrollProfileRow
        Insert: Partial<PayrollProfileRow> & { employee_id: string }
        Update: Partial<PayrollProfileRow>
        Relationships: [
          {
            foreignKeyName: "payroll_profiles_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_adjustments: {
        Row: PayrollAdjustmentRow
        Insert: {
          employee_id: string
          period_start: string
          kind: Database["public"]["Enums"]["payroll_adjustment_kind"]
          amount: number
          reason: string
        }
        Update: never
        Relationships: [
          {
            foreignKeyName: "payroll_adjustments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_adjustments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: PayslipRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslips_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: TaskTemplateRow
        Insert: Partial<TaskTemplateRow> & {
          branch_id: string
          title: string
          start_time: string
          due_time: string
          primary_employee_id: string
        }
        Update: Partial<TaskTemplateRow>
        Relationships: [
          {
            foreignKeyName: "task_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_primary_employee_id_fkey"
            columns: ["primary_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_backup_employee_id_fkey"
            columns: ["backup_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      task_instances: {
        Row: TaskInstanceRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "task_instances_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "task_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_primary_employee_id_fkey"
            columns: ["primary_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_backup_employee_id_fkey"
            columns: ["backup_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_instances_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_aliases: {
        Row: {
          alias_norm: string
          factor: number
          id: string
          item_id: string
          supplier_id: string | null
          unit_name: string
          updated_at: string
        }
        Insert: {
          alias_norm: string
          factor: number
          id?: string
          item_id: string
          supplier_id?: string | null
          unit_name: string
          updated_at?: string
        }
        Update: {
          alias_norm?: string
          factor?: number
          id?: string
          item_id?: string
          supplier_id?: string | null
          unit_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_aliases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_aliases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_item_units: {
        Row: {
          factor: number
          id: string
          item_id: string
          unit_name: string
          updated_at: string
        }
        Insert: {
          factor: number
          id?: string
          item_id: string
          unit_name: string
          updated_at?: string
        }
        Update: {
          factor?: number
          id?: string
          item_id?: string
          unit_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_item_units_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          base_unit: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_unit: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_unit?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_scans: {
        Row: {
          branch_id: string
          created_at: string
          employee_id: string
          error: string | null
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          photo_path: string
          photo_purged_at: string | null
          receipt_id: string | null
          result: Json | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          employee_id: string
          error?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          photo_path: string
          photo_purged_at?: string | null
          receipt_id?: string | null
          result?: Json | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          employee_id?: string
          error?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          photo_path?: string
          photo_purged_at?: string | null
          receipt_id?: string | null
          result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_scans_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_scans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_scans_receipt_fk"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "stock_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          branch_id: string
          item_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          branch_id: string
          item_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          branch_id?: string
          item_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          balance_after: number
          branch_id: string
          change: number
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          kind: Database["public"]["Enums"]["stock_movement_kind"]
          reason: string | null
          receipt_id: string | null
        }
        Insert: {
          balance_after: number
          branch_id: string
          change: number
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          kind: Database["public"]["Enums"]["stock_movement_kind"]
          reason?: string | null
          receipt_id?: string | null
        }
        Update: {
          balance_after?: number
          branch_id?: string
          change?: number
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          kind?: Database["public"]["Enums"]["stock_movement_kind"]
          reason?: string | null
          receipt_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "stock_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_receipt_lines: {
        Row: {
          amount: number
          base_quantity: number
          factor: number
          id: string
          item_id: string
          line_no: number
          quantity: number
          raw_name: string | null
          receipt_id: string
          unit_name: string
          unit_price: number
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          amount: number
          base_quantity: number
          factor: number
          id?: string
          item_id: string
          line_no: number
          quantity: number
          raw_name?: string | null
          receipt_id: string
          unit_name: string
          unit_price: number
          vat_amount?: number
          vat_rate?: number
        }
        Update: {
          amount?: number
          base_quantity?: number
          factor?: number
          id?: string
          item_id?: string
          line_no?: number
          quantity?: number
          raw_name?: string | null
          receipt_id?: string
          unit_name?: string
          unit_price?: number
          vat_amount?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_receipt_lines_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipt_lines_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "stock_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_receipts: {
        Row: {
          branch_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string
          debt_amount: number | null
          due_date: string | null
          id: string
          invoice_date: string
          invoice_number: string | null
          invoice_total: number | null
          note: string | null
          paid_amount: number
          photo_path: string | null
          scan_id: string | null
          status: Database["public"]["Enums"]["stock_receipt_status"]
          subtotal: number
          supplier_id: string | null
          total_amount: number
          vat_amount: number
        }
        Insert: {
          branch_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by: string
          debt_amount?: number | null
          due_date?: string | null
          id?: string
          invoice_date: string
          invoice_number?: string | null
          invoice_total?: number | null
          note?: string | null
          paid_amount?: number
          photo_path?: string | null
          scan_id?: string | null
          status?: Database["public"]["Enums"]["stock_receipt_status"]
          subtotal?: number
          supplier_id?: string | null
          total_amount: number
          vat_amount?: number
        }
        Update: {
          branch_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string
          debt_amount?: number | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string | null
          invoice_total?: number | null
          note?: string | null
          paid_amount?: number
          photo_path?: string | null
          scan_id?: string | null
          status?: Database["public"]["Enums"]["stock_receipt_status"]
          subtotal?: number
          supplier_id?: string | null
          total_amount?: number
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_receipts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "invoice_scans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          note: string | null
          payment_terms_days: number | null
          phone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          note?: string | null
          payment_terms_days?: number | null
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          note?: string | null
          payment_terms_days?: number | null
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          branch_id: string
          created_at: string
          created_by: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_on: string
          receipt_id: string
          supplier_id: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          branch_id: string
          created_at?: string
          created_by: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_on: string
          receipt_id: string
          supplier_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string
          created_at?: string
          created_by?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_on?: string
          receipt_id?: string
          supplier_id?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "stock_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      set_receipt_due_date: {
        Args: { p_due_date: string | null; p_receipt_id: string }
        Returns: undefined
      }
      void_supplier_payment: {
        Args: { p_payment_id: string; p_reason: string }
        Returns: undefined
      }
      record_supplier_payment: {
        Args: {
          p_amount: number
          p_method: Database["public"]["Enums"]["payment_method"]
          p_note?: string
          p_paid_on: string
          p_receipt_id: string
        }
        Returns: string
      }
      adjust_stock: {
        Args: {
          p_branch_id: string
          p_item_id: string
          p_new_quantity: number
          p_reason: string
        }
        Returns: number
      }
      cancel_stock_receipt: {
        Args: { p_reason: string; p_receipt_id: string }
        Returns: undefined
      }
      can_receive_stock_at: {
        Args: { p_branch_id: string }
        Returns: boolean
      }
      create_stock_receipt: {
        Args: { p_payload: Json }
        Returns: string
      }
      save_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string | null }
        Returns: undefined
      }
      delete_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      mark_notifications_read: {
        Args: { p_ids?: string[] | null }
        Returns: number
      }
      publish_week_shifts: {
        Args: { p_branch_id: string; p_week_start: string }
        Returns: number
      }
      copy_week_shifts: {
        Args: { p_branch_id: string; p_from_week: string; p_to_week: string }
        Returns: Json
      }
      bulk_create_shifts: {
        Args: { p_branch_id: string; p_dates: string[]; p_assignments: Json }
        Returns: Json
      }
      my_shift_registrations: {
        Args: { p_branch_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      save_shift_registrations: {
        Args: { p_branch_id: string; p_from: string; p_to: string; p_items: Json }
        Returns: Json
      }
      branch_shift_registrations: {
        Args: { p_branch_id: string; p_from: string; p_to: string }
        Returns: Json
      }
      review_shift_registrations: {
        Args: { p_ids: string[]; p_approve: boolean; p_note?: string | null }
        Returns: Json
      }
      set_self_schedule: {
        Args: { p_employee_id: string; p_enabled: boolean }
        Returns: undefined
      }
      create_schedule_request: {
        Args: {
          p_kind: Database["public"]["Enums"]["request_kind"]
          p_reason: string
          p_start_date?: string | null
          p_end_date?: string | null
          p_shift_id?: string | null
          p_requested_time?: string | null
          p_target_employee_id?: string | null
          p_target_shift_id?: string | null
        }
        Returns: ScheduleRequestRow
        SetofOptions: {
          from: "*"
          to: "schedule_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      respond_swap_request: {
        Args: { p_request_id: string; p_accept: boolean }
        Returns: ScheduleRequestRow
        SetofOptions: {
          from: "*"
          to: "schedule_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_schedule_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      review_schedule_request: {
        Args: { p_request_id: string; p_approve: boolean; p_note?: string | null; p_paid?: boolean }
        Returns: ScheduleRequestRow
        SetofOptions: {
          from: "*"
          to: "schedule_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_leave_paid: {
        Args: { p_request_id: string; p_paid: boolean }
        Returns: ScheduleRequestRow
        SetofOptions: {
          from: "*"
          to: "schedule_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      branch_week_schedule: {
        Args: { p_branch_id: string; p_week_start: string }
        Returns: Json
      }
      branch_colleagues: {
        Args: { p_branch_id: string }
        Returns: { id: string; full_name: string }[]
      }
      my_schedule_requests: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      payroll_overview: {
        Args: { p_period: Database["public"]["Enums"]["pay_period"]; p_period_start: string }
        Returns: Json
      }
      has_payroll_profile: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      my_salary_advances: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      request_salary_advance: {
        Args: { p_amount: number; p_reason?: string | null }
        Returns: Json
      }
      cancel_salary_advance: {
        Args: { p_id: string }
        Returns: undefined
      }
      salary_advance_queue: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      review_salary_advance: {
        Args: { p_id: string; p_approve: boolean; p_note?: string | null }
        Returns: Json
      }
      payroll_preview: {
        Args: { p_employee_id: string; p_period_start: string; p_end_date?: string }
        Returns: Json
      }
      finalize_payslip: {
        Args: { p_employee_id: string; p_period_start: string; p_end_date?: string }
        Returns: PayslipRow
        SetofOptions: {
          from: "*"
          to: "payslips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_task_instance: {
        Args: {
          p_auth_uid: string
          p_instance_id: string
          p_note?: string
          p_photo_path?: string
          p_status: Database["public"]["Enums"]["task_status"]
        }
        Returns: TaskInstanceRow
        SetofOptions: {
          from: "*"
          to: "task_instances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_task_instances: {
        Args: { p_date?: string }
        Returns: number
      }
      reopen_task_instance: {
        Args: { p_instance_id: string; p_reason: string }
        Returns: TaskInstanceRow
        SetofOptions: {
          from: "*"
          to: "task_instances"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_manual_attendance: {
        Args: {
          p_branch_id: string
          p_check_in_at: string
          p_check_out_at: string
          p_employee_id: string
          p_reason: string
        }
        Returns: AttendanceRecordRow
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_check_in: {
        Args: {
          p_accuracy?: number
          p_auth_uid: string
          p_ip?: unknown
          p_lat?: number
          p_lng?: number
        }
        Returns: AttendanceRecordRow
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      attendance_check_out: {
        Args: {
          p_accuracy?: number
          p_auth_uid: string
          p_ip?: unknown
          p_lat?: number
          p_lng?: number
        }
        Returns: AttendanceRecordRow
        SetofOptions: {
          from: "*"
          to: "attendance_records"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_attendance_correction: {
        Args: { p_correction_id: string }
        Returns: undefined
      }
      correct_attendance: {
        Args: {
          p_attendance_id: string
          p_check_in_at: string
          p_check_out_at: string
          p_reason: string
        }
        Returns: undefined
      }
      create_employee: {
        Args: {
          p_auth_user_id: string
          p_branch_ids: string[]
          p_default_start_time: string | null
          p_email: string | null
          p_full_name: string
          p_phone: string | null
          p_requires_attendance: boolean
          p_role: Database["public"]["Enums"]["employee_role"]
          p_sort_order: number
        }
        Returns: string
      }
      request_attendance_correction: {
        Args: {
          p_attendance_id: string
          p_check_in_at: string
          p_check_out_at: string
          p_reason: string
        }
        Returns: AttendanceCorrectionRow
        SetofOptions: {
          from: "*"
          to: "attendance_corrections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_attendance_correction: {
        Args: {
          p_approve: boolean
          p_check_in_at?: string
          p_check_out_at?: string
          p_correction_id: string
          p_note?: string
        }
        Returns: AttendanceCorrectionRow
        SetofOptions: {
          from: "*"
          to: "attendance_corrections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_employee: {
        Args: {
          p_branch_ids: string[]
          p_default_start_time: string | null
          p_email: string | null
          p_employee_id: string
          p_full_name: string
          p_phone: string | null
          p_requires_attendance: boolean
          p_role: Database["public"]["Enums"]["employee_role"]
          p_sort_order: number
        }
        Returns: undefined
      }
    }
    Enums: {
      payment_method: "cash" | "transfer" | "other"
      stock_movement_kind: "receipt" | "receipt_cancel" | "adjust"
      stock_receipt_status: "posted" | "cancelled"
      notification_kind:
        | "task_due_soon"
        | "task_overdue"
        | "task_overdue_report"
        | "request_new"
        | "request_peer"
        | "request_result"
        | "registration_new"
        | "registration_result"
        | "registration_reminder"
        | "advance_new"
        | "advance_result"
      salary_advance_status: "pending" | "approved" | "rejected" | "cancelled"
      shift_status: "draft" | "published" | "cancelled"
      request_kind: "leave" | "late" | "early_leave" | "swap"
      request_status: "awaiting_peer" | "pending" | "approved" | "rejected" | "cancelled"
      registration_status: "pending" | "approved" | "rejected"
      pay_type: "hourly" | "per_shift" | "fixed"
      pay_period: "weekly" | "monthly"
      payroll_adjustment_kind: "kpi" | "bonus" | "allowance" | "deduction" | "correction_plus" | "correction_minus"
      task_frequency: "daily" | "weekly" | "monthly"
      task_priority: "low" | "normal" | "high" | "critical"
      task_status: "pending" | "done" | "failed" | "cancelled"
      attendance_method: "gps" | "wifi" | "manual"
      correction_status: "pending" | "approved" | "rejected" | "cancelled"
      employee_role:
        | "admin"
        | "manager"
        | "head_chef"
        | "staff"
        | "server"
        | "cashier"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export const Constants = {
  public: {
    Enums: {
      attendance_method: ["gps", "wifi", "manual"],
      correction_status: ["pending", "approved", "rejected", "cancelled"],
      employee_role: ["admin", "manager", "head_chef", "staff", "server", "cashier"],
    },
  },
} as const

// ---------------------------------------------------------------------
// Alias dùng trong app
// (Đã chỉnh tay: các tham số text/time cho phép null đúng với hàm SQL)
// ---------------------------------------------------------------------
export type EmployeeRole = Database["public"]["Enums"]["employee_role"]
export type Employee = Database["public"]["Tables"]["employees"]["Row"]
export type Branch = Database["public"]["Tables"]["branches"]["Row"]
export type AttendanceRecord = AttendanceRecordRow
export type AttendanceCorrection = AttendanceCorrectionRow
export type AttendanceMethod = Database["public"]["Enums"]["attendance_method"]
export type CorrectionStatus = Database["public"]["Enums"]["correction_status"]
export type PayrollProfile = PayrollProfileRow
export type PayrollSettings = PayrollSettingsRow
export type PayrollAdjustment = PayrollAdjustmentRow
export type Payslip = PayslipRow
export type PayType = Database["public"]["Enums"]["pay_type"]
export type PayPeriod = Database["public"]["Enums"]["pay_period"]
export type PayrollAdjustmentKind = Database["public"]["Enums"]["payroll_adjustment_kind"]
export type SalaryAdvanceStatus = Database["public"]["Enums"]["salary_advance_status"]
export type TaskTemplate = TaskTemplateRow
export type TaskInstance = TaskInstanceRow
export type TaskFrequency = Database["public"]["Enums"]["task_frequency"]
export type TaskPriority = Database["public"]["Enums"]["task_priority"]
export type TaskStatus = Database["public"]["Enums"]["task_status"]
export type Notification = NotificationRow
export type ScheduleSettings = ScheduleSettingsRow
export type ShiftTemplate = ShiftTemplateRow
export type Shift = ShiftRow
export type ScheduleRequest = ScheduleRequestRow
export type ShiftStatus = Database["public"]["Enums"]["shift_status"]
export type RequestKind = Database["public"]["Enums"]["request_kind"]
export type RequestStatus = Database["public"]["Enums"]["request_status"]
export type RegistrationStatus = Database["public"]["Enums"]["registration_status"]
export type Supplier = Database["public"]["Tables"]["suppliers"]["Row"]
export type InventoryItem = Database["public"]["Tables"]["inventory_items"]["Row"]
export type InventoryItemUnit = Database["public"]["Tables"]["inventory_item_units"]["Row"]
export type StockReceipt = Database["public"]["Tables"]["stock_receipts"]["Row"]
export type StockReceiptLine = Database["public"]["Tables"]["stock_receipt_lines"]["Row"]
export type StockReceiptStatus = Database["public"]["Enums"]["stock_receipt_status"]
export type StockMovementKind = Database["public"]["Enums"]["stock_movement_kind"]
export type PaymentMethod = Database["public"]["Enums"]["payment_method"]
export type SupplierPayment = Database["public"]["Tables"]["supplier_payments"]["Row"]
