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

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
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
      employee_role: [
        "admin",
        "manager",
        "head_chef",
        "staff",
        "server",
        "cashier",
      ],
    },
  },
} as const

// ---------------------------------------------------------------------
// Alias dùng trong app
// ---------------------------------------------------------------------
export type EmployeeRole = Database["public"]["Enums"]["employee_role"]
export type Employee = Database["public"]["Tables"]["employees"]["Row"]
