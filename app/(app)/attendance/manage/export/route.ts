import type { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/session";
import { getManageableBranches } from "@/lib/branches";
import { createClient } from "@/lib/supabase/server";
import { addSheet, createWorkbook, excelResponse, monthRange } from "@/lib/excel";
import { vnDateString } from "@/lib/time";

const METHOD_LABELS: Record<string, string> = { gps: "GPS", wifi: "Wi-Fi", manual: "Nhập tay" };

/** Xuất chấm công 1 tháng: tổng hợp theo nhân viên + chi tiết từng lượt vào/ra */
export async function GET(request: NextRequest) {
  const me = await requireManager();
  const params = request.nextUrl.searchParams;
  const { month, from, to } = monthRange(params.get("month"), vnDateString());
  const branches = await getManageableBranches(me);
  const branchParam = params.get("branch");
  const branchIds = branchParam && branches.some((b) => b.id === branchParam) ? [branchParam] : branches.map((b) => b.id);

  const supabase = await createClient();
  // RLS tự giới hạn theo chi nhánh người thao tác quản lý
  const { data, error } = await supabase
    .from("attendance_records")
    .select(
      "id, employee_id, check_in_at, check_out_at, check_in_method, check_out_method, is_corrected, correction_note, employee:employees!attendance_records_employee_id_fkey(full_name), branch:branches(name)"
    )
    .gte("check_in_at", `${from}T00:00:00+07:00`)
    .lt("check_in_at", `${to}T00:00:00+07:00`)
    .in("branch_id", branchIds)
    .order("check_in_at");
  if (error) return new Response("Không tải được chấm công.", { status: 500 });

  const records = (data ?? []).map((r) => {
    const minutes = r.check_out_at ? Math.max(0, Math.round((Date.parse(r.check_out_at) - Date.parse(r.check_in_at)) / 60000)) : null;
    return { ...r, minutes, workDate: vnDateString(new Date(r.check_in_at)) };
  });

  type Summary = { name: string; days: Set<string>; sessions: number; minutes: number; open: number; corrected: number };
  const byEmployee = new Map<string, Summary>();
  for (const r of records) {
    const s = byEmployee.get(r.employee_id) ?? { name: r.employee?.full_name ?? "", days: new Set(), sessions: 0, minutes: 0, open: 0, corrected: 0 };
    s.days.add(r.workDate);
    s.sessions += 1;
    s.minutes += r.minutes ?? 0;
    if (r.minutes === null) s.open += 1;
    if (r.is_corrected) s.corrected += 1;
    byEmployee.set(r.employee_id, s);
  }
  const summaries = [...byEmployee.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
  const [y, m] = month.split("-");
  const branchName = branchIds.length === 1 ? branches.find((b) => b.id === branchIds[0])?.name : "Tất cả chi nhánh";
  const workbook = createWorkbook();

  addSheet(
    workbook,
    "Tổng hợp",
    [
      { header: "Nhân viên", width: 26, value: (s) => s.name },
      { header: "Số ngày đi làm", type: "int", width: 13, total: true, value: (s) => s.days.size },
      { header: "Số lượt vào/ra", type: "int", width: 13, total: true, value: (s) => s.sessions },
      { header: "Tổng giờ", type: "hours", width: 11, total: true, value: (s) => s.minutes / 60 },
      { header: "Lượt chưa ra ca", type: "int", width: 13, value: (s) => s.open || null },
      { header: "Lượt đã sửa", type: "int", width: 11, value: (s) => s.corrected || null },
    ],
    summaries,
    {
      title: `BẢNG CÔNG THÁNG ${m}/${y}`,
      subtitle: `${branchName}. Giờ công chỉ tính các lượt đã ra ca. Tiền lương, trễ, phạt xem file Bảng lương.`,
    }
  );

  addSheet(
    workbook,
    "Chi tiết",
    [
      { header: "Ngày", type: "date", width: 12, value: (r) => r.workDate },
      { header: "Nhân viên", width: 24, value: (r) => r.employee?.full_name },
      { header: "Chi nhánh", width: 18, value: (r) => r.branch?.name },
      { header: "Giờ vào", type: "datetime", width: 17, value: (r) => r.check_in_at },
      { header: "Giờ ra", type: "datetime", width: 17, value: (r) => r.check_out_at },
      { header: "Số giờ", type: "hours", width: 9, total: true, value: (r) => (r.minutes === null ? null : r.minutes / 60) },
      { header: "Vào bằng", width: 10, value: (r) => METHOD_LABELS[r.check_in_method] ?? r.check_in_method },
      { header: "Ra bằng", width: 10, value: (r) => (r.check_out_method ? METHOD_LABELS[r.check_out_method] ?? r.check_out_method : "Chưa ra ca") },
      { header: "Đã sửa", width: 8, value: (r) => (r.is_corrected ? "Có" : "") },
      { header: "Ghi chú sửa", width: 34, value: (r) => r.correction_note },
    ],
    records,
    { title: `CHI TIẾT CHẤM CÔNG THÁNG ${m}/${y}`, subtitle: branchName }
  );

  return excelResponse(workbook, `Chấm công ${month}.xlsx`);
}
