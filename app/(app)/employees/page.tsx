import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { assignableRoles } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import EmployeesView from "./EmployeesView";

export const metadata: Metadata = { title: "Nhân viên" };
export const instant = false;

export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  const actor = await requireManager();
  const params = await searchParams;
  const showLocked = params.status === "locked";

  const supabase = await createClient();
  const { data: employees, error } = await supabase
    .from("employees")
    .select("id, full_name, email, phone, role, is_active, default_start_time, sort_order, deactivated_at")
    .eq("is_active", !showLocked)
    .order("sort_order", { ascending: true })
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error("Không tải được danh sách nhân viên.");
  }

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Trang chủ
      </Link>
      <div className="mb-6 mt-2">
        <h1 className="text-2xl font-bold tracking-tight">Nhân viên</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Quản lý hồ sơ và tài khoản đăng nhập. Nhân viên nghỉ việc chỉ khóa, không xóa.
        </p>
      </div>

      <EmployeesView
        employees={employees}
        actorId={actor.id}
        actorRole={actor.role}
        assignable={assignableRoles(actor.role)}
        showLocked={showLocked}
      />
    </div>
  );
}
