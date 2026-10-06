import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { assignableRoles } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getManageableBranches } from "@/lib/branches";
import EmployeesView, { type EmployeeListItem } from "./EmployeesView";

export const metadata: Metadata = { title: "Nhân viên" };
export const instant = false;

export default async function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  const actor = await requireManager();
  const params = await searchParams;
  const showLocked = params.status === "locked";

  const supabase = await createClient();
  // RLS tự giới hạn: Quản lý chỉ thấy nhân viên cùng chi nhánh
  const [{ data: employees, error }, { data: links }, branchOptions] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, full_name, email, phone, role, is_active, default_start_time, sort_order, deactivated_at, requires_attendance"
      )
      .eq("is_active", !showLocked)
      .order("sort_order", { ascending: true })
      .order("full_name", { ascending: true }),
    supabase.from("employee_branches").select("employee_id, branches(id, name)"),
    getManageableBranches(actor),
  ]);

  if (error) {
    throw new Error("Không tải được danh sách nhân viên.");
  }

  const branchesByEmployee = new Map<string, { id: string; name: string }[]>();
  for (const link of links ?? []) {
    if (!link.branches) continue;
    const list = branchesByEmployee.get(link.employee_id) ?? [];
    list.push({ id: link.branches.id, name: link.branches.name });
    branchesByEmployee.set(link.employee_id, list);
  }

  const items: EmployeeListItem[] = employees.map((employee) => ({
    ...employee,
    branches: (branchesByEmployee.get(employee.id) ?? []).sort((a, b) => a.name.localeCompare(b.name, "vi")),
  }));

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Trang chủ
      </Link>
      <div className="mb-6 mt-2">
        <h1 className="text-2xl font-bold tracking-tight">Nhân viên</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {actor.role === "admin"
            ? "Quản lý hồ sơ và tài khoản đăng nhập. Nhân viên nghỉ việc chỉ khóa, không xóa."
            : "Nhân viên thuộc chi nhánh bạn quản lý. Nhân viên nghỉ việc chỉ khóa, không xóa."}
        </p>
      </div>

      <EmployeesView
        employees={items}
        actorId={actor.id}
        actorRole={actor.role}
        assignable={assignableRoles(actor.role)}
        branchOptions={branchOptions}
        showLocked={showLocked}
      />
    </div>
  );
}
