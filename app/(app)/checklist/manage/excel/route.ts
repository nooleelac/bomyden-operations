import { requireManager } from "@/lib/auth/session";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { excelResponse } from "@/lib/excel";
import { buildTemplateWorkbook, type ExportTemplate } from "@/lib/checklist-import";

/**
 * File Excel để nhập mẫu công việc cho 1 chi nhánh (có ô chọn sẵn nhân viên, bộ việc...).
 * ?existing=1 → kèm các mẫu đang áp dụng (để sửa rồi nhập sang chi nhánh khác).
 */
export async function GET(request: Request) {
  const me = await requireManager();
  const url = new URL(request.url);
  const branches = await getManageableBranches(me);
  const branch = branches.find((b) => b.id === url.searchParams.get("branch"));
  if (!branch) return new Response("Vui lòng chọn chi nhánh.", { status: 400 });
  const withExisting = url.searchParams.get("existing") === "1";

  const supabase = await createClient();
  const [staffRes, setsRes, templatesRes] = await Promise.all([
    supabase
      .from("employee_branches")
      .select("employee:employees!employee_branches_employee_id_fkey!inner(full_name, is_active)")
      .eq("branch_id", branch.id)
      .eq("employee.is_active", true),
    supabase.from("task_sets").select("name").eq("branch_id", branch.id).order("name"),
    withExisting
      ? supabase
          .from("task_templates")
          .select(
            "title, description, category, priority, start_time, due_time, frequency, weekdays, month_days, requires_photo, requires_note, assign_by_shift, set:task_sets(name), primary:employees!task_templates_primary_employee_id_fkey(full_name), backup:employees!task_templates_backup_employee_id_fkey(full_name)"
          )
          .eq("branch_id", branch.id)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("sort_order")
          .order("start_time")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (staffRes.error || setsRes.error || templatesRes.error) return new Response("Không tải được dữ liệu.", { status: 500 });

  const templates: ExportTemplate[] = (templatesRes.data ?? []).map((t) => ({
    title: t.title,
    category: t.category,
    priority: t.priority,
    startTime: t.start_time.slice(0, 5),
    dueTime: t.due_time.slice(0, 5),
    frequency: t.frequency,
    weekdays: t.weekdays,
    monthDays: t.month_days,
    requiresPhoto: t.requires_photo,
    requiresNote: t.requires_note,
    assignByShift: t.assign_by_shift,
    primaryName: t.primary?.full_name ?? null,
    backupName: t.backup?.full_name ?? null,
    setName: t.set?.name ?? null,
    description: t.description,
  }));

  const workbook = buildTemplateWorkbook({
    branchName: branch.name,
    staff: staffRes.data.map((r) => ({ name: r.employee.full_name })).sort((a, b) => a.name.localeCompare(b.name, "vi")),
    sets: setsRes.data.map((s) => s.name),
    templates,
  });
  return excelResponse(workbook, `${withExisting ? "Danh sach cong viec" : "Mau nhap cong viec"} - ${branch.name}.xlsx`);
}
