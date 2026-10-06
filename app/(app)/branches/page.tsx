import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/request-ip";
import BranchesView, { type BranchItem } from "./BranchesView";

export const metadata: Metadata = { title: "Chi nhánh" };
export const instant = false;

export default async function BranchesPage() {
  await requireAdmin();
  const supabase = await createClient();

  const [{ data: branches, error }, { data: links }] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name, address, latitude, longitude, radius_m, wifi_ips, is_active")
      .order("is_active", { ascending: false })
      .order("name"),
    supabase.from("employee_branches").select("branch_id, employees!inner(is_active)").eq("employees.is_active", true),
  ]);

  if (error) throw new Error("Không tải được danh sách chi nhánh.");

  const counts = new Map<string, number>();
  for (const link of links ?? []) {
    counts.set(link.branch_id, (counts.get(link.branch_id) ?? 0) + 1);
  }

  const items: BranchItem[] = branches.map((branch) => ({
    ...branch,
    wifi_ips: (branch.wifi_ips ?? []).map(String),
    employee_count: counts.get(branch.id) ?? 0,
  }));

  return (
    <div>
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Trang chủ
      </Link>
      <div className="mb-6 mt-2">
        <h1 className="text-2xl font-bold tracking-tight">Chi nhánh</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Vị trí GPS và Wi-Fi dùng để xác nhận nhân viên đang ở quán khi chấm công.
        </p>
      </div>

      <BranchesView branches={items} currentIp={await getClientIp()} />
    </div>
  );
}
