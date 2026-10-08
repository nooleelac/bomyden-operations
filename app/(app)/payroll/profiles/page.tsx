import type { Metadata } from "next";
import Link from "next/link";
import { requirePayrollAccess } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import PayrollNav from "../PayrollNav";
import ProfilesView from "./ProfilesView";
import type { ProfileRow } from "./ProfileDialog";

export const metadata: Metadata = { title: "Hồ sơ lương" };
export const instant = false;

export default async function ProfilesPage() {
  const actor = await requirePayrollAccess();
  const isAdmin = actor.role === "admin";
  const supabase = await createClient();

  // RLS giới hạn nhân viên theo chi nhánh; với Quản lý, loại thêm Quản lý/QTV và chính mình (khớp quyền lương ở DB)
  const [{ data: employees, error }, { data: profiles }, { data: settings }] = await Promise.all([
    supabase.from("employees").select("id, full_name, role").eq("is_active", true).order("sort_order").order("full_name"),
    supabase.from("payroll_profiles").select("*"),
    supabase.from("payroll_settings").select("*").single(),
  ]);
  if (error || !settings) throw new Error("Không tải được hồ sơ lương.");

  const byEmployee = new Map((profiles ?? []).map((p) => [p.employee_id, p]));
  const rows: ProfileRow[] = employees
    .filter((e) => e.role !== "admin" && (isAdmin || (e.role !== "manager" && e.id !== actor.id)))
    .map((e) => ({ employeeId: e.id, name: e.full_name, roleLabel: ROLE_LABELS[e.role], profile: byEmployee.get(e.id) ?? null }));

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Hồ sơ lương</h1>
      <PayrollNav active="profiles" isAdmin={isAdmin} />
      <p className="mb-4 text-sm text-neutral-500">
        Thay đổi hồ sơ chỉ ảnh hưởng các kỳ chưa chốt. Đổi kỳ lương tuần ↔ tháng nên làm vào đầu kỳ mới.
      </p>
      <ProfilesView rows={rows} settings={settings} isAdmin={isAdmin} />
    </div>
  );
}
