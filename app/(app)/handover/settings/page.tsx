import type { Metadata } from "next";
import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import BranchChips from "../../inventory/BranchChips";
import SettingsView from "./SettingsView";
import StaffPermissions from "./StaffPermissions";

export const metadata: Metadata = { title: "Món & phân quyền bàn giao" };
export const instant = false;

export default async function HandoverSettingsPage({ searchParams }: PageProps<"/handover/settings">) {
  const me = await requireManager();
  const params = await searchParams;
  const branches = await getManageableBranches(me);
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : branches[0]?.id;

  if (!branchId) {
    return <p className="alert-info">Bạn chưa được gán chi nhánh nào.</p>;
  }

  const supabase = await createClient();
  const [{ data: rows, error }, { data: staff }, { data: receivers }] = await Promise.all([
    supabase
      .from("handover_items")
      .select("id, name, unit, requires_photo, handover_item_staff(employee_id)")
      .eq("branch_id", branchId)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("employee_branches")
      .select("employee:employees!employee_branches_employee_id_fkey!inner(id, full_name, role, is_active)")
      .eq("branch_id", branchId)
      .eq("employee.is_active", true),
    supabase.from("handover_receivers").select("employee_id").eq("branch_id", branchId),
  ]);
  if (error) throw new Error("Không tải được danh sách món bàn giao.");

  const items = rows ?? [];
  const employees = (staff ?? [])
    .map((s) => s.employee)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "vi"))
    .map((e) => ({
      id: e.id,
      name: e.full_name,
      role: ROLE_LABELS[e.role],
      itemIds: items.filter((i) => i.handover_item_staff.some((s) => s.employee_id === e.id)).map((i) => i.id),
      canReceive: (receivers ?? []).some((r) => r.employee_id === e.id),
    }));

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/handover?branch=${branchId}`} className="text-sm text-neutral-500 hover:text-neutral-900">← Bàn giao ca</Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold tracking-tight">Món & phân quyền bàn giao</h1>
      <p className="mb-4 text-sm text-neutral-500">
        Những món nhân viên phải cân / đếm và chụp ảnh mỗi lần bàn giao ca. Danh sách riêng, không liên kết danh mục Kho (nhân viên không thấy nguyên liệu kho) và không ảnh hưởng tồn kho. QTV và Quản lý chi nhánh thêm, sửa, sắp xếp, gỡ món.
      </p>
      <BranchChips branches={branches} branchId={branchId} href={(id) => `?branch=${id}`} />
      <SettingsView
        key={branchId}
        branchId={branchId}
        rows={items.map((r) => ({ id: r.id, name: r.name, unit: r.unit, requiresPhoto: r.requires_photo }))}
      />
      <StaffPermissions
        key={`staff-${branchId}`}
        branchId={branchId}
        items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))}
        employees={employees}
      />
    </div>
  );
}
