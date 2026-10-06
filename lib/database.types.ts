// Kiểu dữ liệu database.
// Tạm viết tay theo migration Phase 1. Sau khi có project Supabase sẽ thay bằng file sinh tự động:
//   npx supabase gen types typescript --project-id <id> > lib/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type EmployeeRole =
  | "admin"
  | "manager"
  | "head_chef"
  | "staff"
  | "server"
  | "cashier";

export type Database = {
  public: {
    Tables: {
      employees: {
        Row: {
          id: string;
          auth_user_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          role: EmployeeRole;
          is_active: boolean;
          default_start_time: string | null;
          sort_order: number;
          deactivated_at: string | null;
          deactivated_by: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          auth_user_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          role?: EmployeeRole;
          is_active?: boolean;
          default_start_time?: string | null;
          sort_order?: number;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          auth_user_id?: string;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          role?: EmployeeRole;
          is_active?: boolean;
          default_start_time?: string | null;
          sort_order?: number;
          deactivated_at?: string | null;
          deactivated_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: number;
          table_name: string;
          record_id: string | null;
          action: string;
          actor_auth_uid: string | null;
          actor_employee_id: string | null;
          old_data: Json | null;
          new_data: Json | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          table_name: string;
          record_id?: string | null;
          action: string;
          actor_auth_uid?: string | null;
          actor_employee_id?: string | null;
          old_data?: Json | null;
          new_data?: Json | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          table_name?: string;
          record_id?: string | null;
          action?: string;
          actor_auth_uid?: string | null;
          actor_employee_id?: string | null;
          old_data?: Json | null;
          new_data?: Json | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      employee_role: EmployeeRole;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Employee = Database["public"]["Tables"]["employees"]["Row"];
