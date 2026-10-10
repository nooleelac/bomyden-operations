import type { NextRequest } from "next/server";
import { requireEmployee } from "@/lib/auth/session";
import { mustClockIn } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { addSheet, createWorkbook, excelResponse, monthRange } from "@/lib/excel";
import { hm } from "@/lib/schedule";
import { vnDateString } from "@/lib/time";

const METHOD_LABELS: Record<string, string> = { gps: "GPS", wifi: "Wi-Fi", manual: "Nhập tay" };

/** NV tự xuất lịch sử chấm công 1 tháng của mình (kèm ca theo lịch để đối chiếu) */
export async function GET(request: NextRequest) {
  const me = await requireEmployee();
  if (!mustClockIn(me)) return new Response("Tài khoản của bạn không cần chấm công.", { status: 403 });
  const { month, from, to } = monthRange(request.nextUrl.searchParams.get("month"), vnDateString());

  const supabase = await createClient();
  const [recordsRes, shiftsRes] = await Promise.all([
    supabase
      .from("attendance_records")
      .select("id, check_in_at, check_out_at, check_in_method, check_out_method, is_corrected, correction_note, branch:branches(name)")
      .eq("employee_id", me.id)
      .gte("check_in_at", `${from}T00:00:00+07:00`)
      .lt("check_in_at", `${to}T00:00:00+07:00`)
      .order("check_in_at"),
    supabase
      .from("shifts")
      .select("work_date, start_time, end_time")
      .eq("employee_id", me.id)
      .eq("status", "published")
      .gte("work_date", from)
      .lt("work_date", to)
      .order("start_at"),
  ]);
  if (recordsRes.error || shiftsRes.error) return new Response("Không tải được chấm công.", { status: 500 });

  // Ca theo lịch của từng ngày, VD "08:00–14:00, 17:00–22:00"
  const shiftsByDate = new Map<string, string[]>();
  for (const s of shiftsRes.data ?? []) {
    shiftsByDate.set(s.work_date, [...(shiftsByDate.get(s.work_date) ?? []), `${hm(s.start_time)}–${hm(s.end_time)}`]);
  }

  const records = (recordsRes.data ?? []).map((r) => {
    const minutes = r.check_out_at ? Math.max(0, Math.round((Date.parse(r.check_out_at) - Date.parse(r.check_in_at)) / 60000)) : null;
    return { ...r, minutes, workDate: vnDateString(new Date(r.check_in_at)) };
  });
  const days = new Set(records.map((r) => r.workDate)).size;
  const totalHours = records.reduce((sum, r) => sum + (r.minutes ?? 0), 0) / 60;
  const open = records.filter((r) => r.minutes === null).length;
  const [y, m] = month.split("-");
  const workbook = createWorkbook();

  addSheet(
    workbook,
    "Chấm công",
    [
      { header: "Ngày", type: "date", width: 12, value: (r) => r.workDate },
      { header: "Chi nhánh", width: 18, value: (r) => r.branch?.name },
      { header: "Ca theo lịch", width: 16, value: (r) => shiftsByDate.get(r.workDate)?.join(", ") },
      { header: "Giờ vào", type: "datetime", width: 17, value: (r) => r.check_in_at },
      { header: "Giờ ra", type: "datetime", width: 17, value: (r) => r.check_out_at },
      { header: "Số giờ", type: "hours", width: 9, total: true, value: (r) => (r.minutes === null ? null : r.minutes / 60) },
      { header: "Vào bằng", width: 10, value: (r) => METHOD_LABELS[r.check_in_method] ?? r.check_in_method },
      { header: "Ra bằng", width: 10, value: (r) => (r.check_out_method ? METHOD_LABELS[r.check_out_method] ?? r.check_out_method : "Chưa ra ca") },
      { header: "Đã sửa", width: 8, value: (r) => (r.is_corrected ? "Có" : "") },
      { header: "Ghi chú sửa", width: 34, value: (r) => r.correction_note },
    ],
    records,
    {
      title: `CHẤM CÔNG THÁNG ${m}/${y} — ${me.full_name.toUpperCase()}`,
      subtitle:
        `${days} ngày đi làm · ${records.length} lượt vào/ra · ${totalHours.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} giờ` +
        (open ? ` · ${open} lượt chưa ra ca (không tính giờ)` : "") +
        ". Tiền lương, trễ, phạt xem Phiếu lương.",
    }
  );

  return excelResponse(workbook, `Chấm công ${month} - ${me.full_name}.xlsx`);
}
