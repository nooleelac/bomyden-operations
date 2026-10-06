import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CurrentEmployee } from "@/lib/auth/session";

export type BranchRef = { id: string; name: string };

/**
 * Chi nhánh (đang hoạt động) mà người thao tác được quản lý:
 * Quản trị viên → tất cả; Quản lý → chi nhánh mình được gán.
 */
export async function getManageableBranches(actor: CurrentEmployee): Promise<BranchRef[]> {
  const supabase = await createClient();

  if (actor.role === "admin") {
    const { data } = await supabase.from("branches").select("id, name").eq("is_active", true).order("name");
    return data ?? [];
  }

  if (actor.role !== "manager") return [];

  const { data } = await supabase
    .from("employee_branches")
    .select("branches!inner(id, name, is_active)")
    .eq("employee_id", actor.id)
    .eq("branches.is_active", true);

  return (data ?? [])
    .map((row) => ({ id: row.branches.id, name: row.branches.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}
