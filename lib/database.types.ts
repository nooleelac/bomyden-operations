// FILE SINH TỰ ĐỘNG từ Supabase (project bomyden-ops-v2). Không sửa tay phần Database.
// Sinh lại sau mỗi migration:
//   npx supabase gen types typescript --project-id jsnidpylkkhjfhyzxayp > lib/database.types.ts
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
export type TaskTemplate = TaskTemplateRow
export type TaskInstance = TaskInstanceRow
export type TaskFrequency = Database["public"]["Enums"]["task_frequency"]
export type TaskPriority = Database["public"]["Enums"]["task_priority"]
export type TaskStatus = Database["public"]["Enums"]["task_status"]
