import "server-only";

import ExcelJS from "exceljs";
import { PRIORITIES, PRIORITY_LABELS, TASK_CATEGORIES, WEEKDAY_LABELS, parseMonthDays } from "@/lib/checklist";
import { createWorkbook } from "@/lib/excel";
import type { TaskFrequency, TaskPriority } from "@/lib/database.types";

// Nhập / xuất mẫu công việc bằng Excel. Cột nhận diện theo TÊN tiêu đề (đổi thứ tự cột vẫn đọc đúng).

export const MAX_IMPORT_ROWS = 500;

const SHEET_NAME = "Mẫu công việc";
const LISTS_SHEET = "Danh mục";
const SHIFT_LABEL = "Theo ca";
const FREQ_LABELS: Record<TaskFrequency, string> = { daily: "Hằng ngày", weekly: "Theo thứ", monthly: "Theo ngày tháng" };

const COLUMNS = [
  { key: "title", header: "Tên công việc *", width: 34 },
  { key: "category", header: "Nhóm", width: 18 },
  { key: "priority", header: "Mức độ", width: 14 },
  { key: "start", header: "Bắt đầu *", width: 11 },
  { key: "due", header: "Hạn chót *", width: 11 },
  { key: "frequency", header: "Lặp lại", width: 17 },
  { key: "weekdays", header: "Thứ trong tuần", width: 18 },
  { key: "monthDays", header: "Ngày trong tháng", width: 17 },
  { key: "photo", header: "Bắt buộc ảnh", width: 13 },
  { key: "note", header: "Bắt buộc ghi chú", width: 15 },
  { key: "assignee", header: "Giao cho", width: 22 },
  { key: "backup", header: "Người thay thế", width: 22 },
  { key: "set", header: "Bộ việc", width: 18 },
  { key: "description", header: "Hướng dẫn", width: 40 },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

export type ImportContext = {
  staff: { id: string; name: string }[];
  /** Mẫu đang áp dụng của chi nhánh (để báo trùng việc trước khi nhập) */
  existing: { title: string; primaryId: string | null; assignByShift: boolean }[];
};

export type ExportTemplate = {
  title: string;
  category: string;
  priority: TaskPriority;
  startTime: string;
  dueTime: string;
  frequency: TaskFrequency;
  weekdays: number[];
  monthDays: number[];
  requiresPhoto: boolean;
  requiresNote: boolean;
  assignByShift: boolean;
  primaryName: string | null;
  backupName: string | null;
  setName: string | null;
  description: string | null;
};

export type ImportRow = {
  title: string;
  description: string | null;
  category: string;
  priority: TaskPriority;
  start_time: string;
  due_time: string;
  frequency: TaskFrequency;
  weekdays: number[];
  month_days: number[];
  requires_photo: boolean;
  requires_note: boolean;
  assign_by_shift: boolean;
  primary_employee_id: string | null;
  backup_employee_id: string | null;
  set_name: string | null;
  sort_order: number;
};

export type ImportPreviewRow = {
  line: number;
  title: string;
  time: string;
  schedule: string;
  assignee: string;
  setName: string | null;
};

export type ImportResult = {
  rows: ImportRow[];
  preview: ImportPreviewRow[];
  errors: { line: number; message: string }[];
};

/** So khớp không phân biệt hoa/thường, dấu cách thừa (giữ dấu tiếng Việt) */
export const normKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// ---------------------------------------------------------------------
// FILE MẪU (+ danh sách hiện có)
// ---------------------------------------------------------------------
export function buildTemplateWorkbook(opts: {
  branchName: string;
  staff: { name: string }[];
  sets: string[];
  templates: ExportTemplate[];
}): ExcelJS.Workbook {
  const wb = createWorkbook();
  const sheet = wb.addWorksheet(SHEET_NAME);

  const header = sheet.getRow(1);
  COLUMNS.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF171717" } };
    cell.alignment = { vertical: "middle" };
    sheet.getColumn(i + 1).width = col.width;
  });
  header.height = 22;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  // Giờ nhập dạng chữ "10:00" để Excel không tự đổi
  sheet.getColumn(4).numFmt = "@";
  sheet.getColumn(5).numFmt = "@";

  opts.templates.forEach((t, r) => {
    const row = sheet.getRow(r + 2);
    const values: Record<ColumnKey, string> = {
      title: t.title,
      category: t.category,
      priority: PRIORITY_LABELS[t.priority].label,
      start: t.startTime,
      due: t.dueTime,
      frequency: FREQ_LABELS[t.frequency],
      weekdays: t.weekdays.map((d) => WEEKDAY_LABELS[d]).join(", "),
      monthDays: t.monthDays.join(", "),
      photo: t.requiresPhoto ? "Có" : "",
      note: t.requiresNote ? "Có" : "",
      assignee: t.assignByShift ? SHIFT_LABEL : t.primaryName ?? "",
      backup: t.backupName ?? "",
      set: t.setName ?? "",
      description: t.description ?? "",
    };
    COLUMNS.forEach((col, i) => {
      row.getCell(i + 1).value = values[col.key] || null;
    });
  });

  // Danh mục cho ô chọn (sheet ẩn)
  const lists = wb.addWorksheet(LISTS_SHEET, { state: "hidden" });
  const listCols: string[][] = [
    ["Nhóm", ...TASK_CATEGORIES],
    ["Mức độ", ...PRIORITIES.map((p) => PRIORITY_LABELS[p].label)],
    ["Lặp lại", ...Object.values(FREQ_LABELS)],
    ["Có/Không", "Có", "Không"],
    ["Giao cho", SHIFT_LABEL, ...opts.staff.map((s) => s.name)],
    ["Nhân viên", ...opts.staff.map((s) => s.name)],
    ["Bộ việc", ...opts.sets],
  ];
  listCols.forEach((values, c) => values.forEach((v, r) => (lists.getCell(r + 1, c + 1).value = v)));
  const ref = (c: number) => {
    const col = String.fromCharCode(65 + c);
    return `'${LISTS_SHEET}'!$${col}$2:$${col}$${Math.max(2, listCols[c].length)}`;
  };
  const last = MAX_IMPORT_ROWS + 1;
  const list = (column: string, listIndex: number, strict: boolean) => {
    const validation: ExcelJS.DataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [ref(listIndex)],
      showErrorMessage: strict,
      errorStyle: "warning",
      error: "Giá trị không có trong danh sách.",
    };
    for (let r = 2; r <= last; r++) sheet.getCell(`${column}${r}`).dataValidation = validation;
  };
  list("B", 0, true);
  list("C", 1, true);
  list("F", 2, true);
  list("I", 3, true);
  list("J", 3, true);
  list("K", 4, true);
  list("L", 5, true);
  list("M", 6, false); // bộ việc mới: gõ tên mới được

  // Hướng dẫn
  const guide = wb.addWorksheet("Hướng dẫn");
  guide.getColumn(1).width = 22;
  guide.getColumn(2).width = 90;
  const lines: [string, string][] = [
    ["NHẬP MẪU CÔNG VIỆC", `Chi nhánh: ${opts.branchName}. Mỗi dòng ở sheet "${SHEET_NAME}" là 1 công việc (tối đa ${MAX_IMPORT_ROWS} dòng).`],
    ["", "Có lỗi ở bất kỳ dòng nào → không dòng nào được nhập. App sẽ báo lỗi theo số dòng để bạn sửa."],
    ["", "Nhập file này sẽ TẠO MỚI các công việc (không sửa công việc đã có)."],
    ["Tên công việc *", "Bắt buộc. Tối đa 150 ký tự."],
    ["Nhóm", `${TASK_CATEGORIES.join(" / ")}. Để trống = Khác.`],
    ["Mức độ", `${PRIORITIES.map((p) => PRIORITY_LABELS[p].label).join(" / ")}. Để trống = Bình thường.`],
    ["Bắt đầu * / Hạn chót *", "Giờ dạng 10:00 hoặc 10h30. Hạn chót phải sau giờ bắt đầu (trong cùng ngày)."],
    ["Lặp lại", "Hằng ngày / Theo thứ / Theo ngày tháng. Để trống: tự hiểu theo cột Thứ hoặc Ngày trong tháng, nếu không có thì Hằng ngày."],
    ["Thứ trong tuần", "Khi lặp Theo thứ. VD: T2, T4, T6 hoặc CN."],
    ["Ngày trong tháng", "Khi lặp Theo ngày tháng. VD: 1, 15, 31 (tháng không có ngày 31 thì chạy ngày cuối tháng)."],
    ["Bắt buộc ảnh / ghi chú", "Có / Không. Để trống = Không."],
    ["Giao cho", `Tên nhân viên của chi nhánh, hoặc "${SHIFT_LABEL}" (ai có ca trùng giờ việc thì nhận). Để trống = chưa giao (giao sau).`],
    ["Người thay thế", "Tùy chọn, chỉ khi giao cho 1 nhân viên. Phải khác người chính."],
    ["Bộ việc", "Tùy chọn. Tên bộ chưa có sẽ được tạo mới."],
    ["Hướng dẫn", "Tùy chọn, tối đa 1000 ký tự."],
    ["Không trùng việc", "1 nhân viên (hoặc Theo ca) không được có 2 công việc đang áp dụng cùng tên trong chi nhánh."],
    ["VÍ DỤ", "Kiểm kê thịt bò | Kiểm kê | Quan trọng | 14:00 | 14:30 | Hằng ngày | | | Có | | Theo ca | | Đóng ca | Đếm số khay trong tủ"],
  ];
  lines.forEach(([a, b], r) => {
    guide.getCell(r + 1, 1).value = a;
    guide.getCell(r + 1, 1).font = { bold: true };
    guide.getCell(r + 1, 2).value = b;
    guide.getCell(r + 1, 2).alignment = { wrapText: true, vertical: "top" };
  });
  return wb;
}

// ---------------------------------------------------------------------
// ĐỌC FILE
// ---------------------------------------------------------------------
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text);
    return "";
  }
  return String(value);
}

/** "10:00" | "10h" | "10h30" | Excel time (Date / số thập phân) → "HH:MM" */
function parseTime(value: ExcelJS.CellValue): string | null {
  let h: number;
  let m: number;
  if (value instanceof Date) {
    h = value.getUTCHours();
    m = value.getUTCMinutes();
  } else if (typeof value === "number") {
    if (value < 0 || value >= 1) return null;
    const total = Math.round(value * 1440);
    h = Math.floor(total / 60);
    m = total % 60;
  } else {
    const match = cellText(value).trim().toLowerCase().match(/^(\d{1,2})\s*(?:[:h.]\s*(\d{1,2})?)?\s*(?:p|phút)?$/);
    if (!match) return null;
    h = Number(match[1]);
    m = match[2] ? Number(match[2]) : 0;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "T2, T4, CN" | "Thứ 2" | "2,4" → [1, 3, 7] (ISO: T2 = 1 … CN = 7) */
function parseWeekdays(text: string): number[] | null {
  const items = text.split(/[,;/]+/).map((s) => normKey(s)).filter(Boolean);
  const days = new Set<number>();
  for (const item of items) {
    if (["cn", "chủ nhật", "chu nhat"].includes(item)) {
      days.add(7);
      continue;
    }
    const m = item.match(/^(?:t|thứ|thu)?\s*([2-8])$/);
    if (!m) return null;
    days.add(Number(m[1]) === 8 ? 7 : Number(m[1]) - 1);
  }
  return [...days].sort((a, b) => a - b);
}

const YES = new Set(["có", "co", "x", "yes", "y", "1", "true", "✓"]);
const NO = new Set(["", "không", "khong", "no", "n", "0", "false"]);

export async function parseImportFile(buffer: ArrayBuffer, ctx: ImportContext): Promise<ImportResult> {
  const errors: ImportResult["errors"] = [];
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    return { rows: [], preview: [], errors: [{ line: 0, message: "Không đọc được file. Hãy dùng file .xlsx (tải file mẫu ở nút bên cạnh)." }] };
  }
  const sheet = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets.find((s) => s.state !== "hidden");
  if (!sheet) return { rows: [], preview: [], errors: [{ line: 0, message: "File không có sheet dữ liệu." }] };

  // Tìm dòng tiêu đề trong 5 dòng đầu, nhận cột theo tên
  const headerKey = (s: string) => normKey(s.replace("*", ""));
  const wanted = new Map(COLUMNS.map((c) => [headerKey(c.header), c.key]));
  let headerRow = 0;
  const colOf = new Map<ColumnKey, number>();
  for (let r = 1; r <= 5 && !headerRow; r++) {
    const found = new Map<ColumnKey, number>();
    sheet.getRow(r).eachCell((cell, c) => {
      const key = wanted.get(headerKey(cellText(cell.value)));
      if (key) found.set(key, c);
    });
    if (found.has("title")) {
      headerRow = r;
      found.forEach((c, k) => colOf.set(k, c));
    }
  }
  if (!headerRow) {
    return { rows: [], preview: [], errors: [{ line: 0, message: 'Không thấy cột "Tên công việc". Hãy dùng file mẫu.' }] };
  }
  for (const req of ["start", "due"] as const) {
    if (!colOf.has(req)) {
      const col = COLUMNS.find((c) => c.key === req)!;
      return { rows: [], preview: [], errors: [{ line: 0, message: `Thiếu cột "${col.header.replace(" *", "")}".` }] };
    }
  }

  const staffByName = new Map<string, { id: string; name: string }[]>();
  for (const s of ctx.staff) staffByName.set(normKey(s.name), [...(staffByName.get(normKey(s.name)) ?? []), s]);
  const findStaff = (name: string, line: number, label: string): string | null | undefined => {
    const hits = staffByName.get(normKey(name)) ?? [];
    if (hits.length === 1) return hits[0].id;
    errors.push({
      line,
      message: hits.length > 1 ? `${label} "${name}": có nhiều nhân viên trùng tên.` : `${label} "${name}" không phải nhân viên đang làm tại chi nhánh này.`,
    });
    return undefined;
  };
  const categoryByKey = new Map(TASK_CATEGORIES.map((c) => [normKey(c), c]));
  const priorityByKey = new Map<string, TaskPriority>(PRIORITIES.map((p) => [normKey(PRIORITY_LABELS[p].label), p]));
  const freqByKey = new Map<string, TaskFrequency>([
    ...Object.entries(FREQ_LABELS).map(([k, v]) => [normKey(v), k as TaskFrequency] as const),
    ["hàng ngày", "daily"],
    ["mỗi ngày", "daily"],
    ["hằng tuần", "weekly"],
    ["hàng tuần", "weekly"],
    ["hằng tháng", "monthly"],
    ["hàng tháng", "monthly"],
  ]);

  // Chống trùng việc: (người | theo ca) + tên
  const taken = new Set(
    ctx.existing.flatMap((t) => [
      ...(t.primaryId ? [`p:${t.primaryId}|${normKey(t.title)}`] : []),
      ...(t.assignByShift ? [`s|${normKey(t.title)}`] : []),
    ])
  );
  const nameOf = new Map(ctx.staff.map((s) => [s.id, s.name]));

  const rows: ImportRow[] = [];
  const preview: ImportPreviewRow[] = [];
  const last = Math.min(sheet.rowCount, headerRow + 2000);
  for (let r = headerRow + 1; r <= last; r++) {
    const row = sheet.getRow(r);
    const raw = (k: ColumnKey) => (colOf.has(k) ? row.getCell(colOf.get(k)!).value : null);
    const text = (k: ColumnKey) => cellText(raw(k)).trim();
    if (COLUMNS.every((c) => !text(c.key))) continue; // dòng trống
    if (rows.length + errors.length >= MAX_IMPORT_ROWS + 50) break;

    const before = errors.length;
    const err = (message: string) => errors.push({ line: r, message });

    const title = text("title").replace(/\s+/g, " ");
    if (!title) err("Thiếu tên công việc.");
    else if (title.length > 150) err("Tên công việc tối đa 150 ký tự.");

    const catText = text("category");
    const category = catText ? categoryByKey.get(normKey(catText)) : "Khác";
    if (!category) err(`Nhóm "${catText}" không hợp lệ (${TASK_CATEGORIES.join(", ")}).`);

    const priText = text("priority");
    const priority = priText ? priorityByKey.get(normKey(priText)) : "normal";
    if (!priority) err(`Mức độ "${priText}" không hợp lệ.`);

    const start = parseTime(raw("start"));
    const due = parseTime(raw("due"));
    if (!start) err(`Giờ bắt đầu "${text("start")}" không hợp lệ (VD 10:00).`);
    if (!due) err(`Hạn chót "${text("due")}" không hợp lệ (VD 11:00).`);
    if (start && due && due <= start) err("Hạn chót phải sau giờ bắt đầu.");

    const wdText = text("weekdays");
    const mdText = text("monthDays");
    const weekdays = wdText ? parseWeekdays(wdText) : [];
    const monthDays = mdText ? parseMonthDays(mdText) : [];
    if (weekdays === null) err(`Thứ "${wdText}" không hợp lệ (VD: T2, T4, CN).`);
    if (monthDays === null) err(`Ngày trong tháng "${mdText}" không hợp lệ (VD: 1, 15).`);
    const freqText = text("frequency");
    let frequency: TaskFrequency | undefined = freqText
      ? freqByKey.get(normKey(freqText))
      : weekdays?.length
        ? "weekly"
        : monthDays?.length
          ? "monthly"
          : "daily";
    if (!frequency) err(`Lặp lại "${freqText}" không hợp lệ (Hằng ngày / Theo thứ / Theo ngày tháng).`);
    if (frequency === "weekly" && !weekdays?.length) err("Lặp theo thứ: cần điền cột Thứ trong tuần.");
    if (frequency === "monthly" && !monthDays?.length) err("Lặp theo ngày tháng: cần điền cột Ngày trong tháng.");
    frequency ??= "daily";

    const yesNo = (k: ColumnKey, label: string) => {
      const v = normKey(text(k));
      if (YES.has(v)) return true;
      if (!NO.has(v)) err(`${label}: ghi "Có" hoặc để trống.`);
      return false;
    };
    const requiresPhoto = yesNo("photo", "Bắt buộc ảnh");
    const requiresNote = yesNo("note", "Bắt buộc ghi chú");

    const assigneeText = text("assignee");
    const byShift = normKey(assigneeText) === normKey(SHIFT_LABEL);
    const primaryId = assigneeText && !byShift ? findStaff(assigneeText, r, "Giao cho") : null;
    const backupText = text("backup");
    let backupId: string | null | undefined = null;
    if (backupText) {
      if (!assigneeText || byShift) err("Người thay thế chỉ dùng khi giao cho 1 nhân viên cụ thể.");
      else backupId = findStaff(backupText, r, "Người thay thế");
      if (backupId && backupId === primaryId) err("Người thay thế phải khác người chính.");
    }

    const setName = text("set").replace(/\s+/g, " ") || null;
    if (setName && setName.length > 50) err("Tên bộ việc tối đa 50 ký tự.");
    const description = text("description") || null;
    if (description && description.length > 1000) err("Hướng dẫn tối đa 1000 ký tự.");

    if (title && (primaryId || byShift)) {
      const k = byShift ? `s|${normKey(title)}` : `p:${primaryId}|${normKey(title)}`;
      if (taken.has(k)) err(byShift ? `Trùng việc: đã có "${title}" giao theo ca.` : `Trùng việc: ${nameOf.get(primaryId!)} đã có "${title}".`);
      taken.add(k);
    }

    if (errors.length > before) continue;
    rows.push({
      title,
      description,
      category: category!,
      priority: priority!,
      start_time: start!,
      due_time: due!,
      frequency,
      weekdays: frequency === "weekly" ? weekdays! : [],
      month_days: frequency === "monthly" ? monthDays! : [],
      requires_photo: requiresPhoto,
      requires_note: requiresNote,
      assign_by_shift: byShift,
      primary_employee_id: primaryId ?? null,
      backup_employee_id: backupId ?? null,
      set_name: setName,
      sort_order: 0,
    });
    preview.push({
      line: r,
      title,
      time: `${start}–${due}`,
      schedule:
        frequency === "daily"
          ? "Hằng ngày"
          : frequency === "weekly"
            ? weekdays!.map((d) => WEEKDAY_LABELS[d]).join(", ")
            : `Ngày ${monthDays!.join(", ")}`,
      assignee: byShift ? "🕒 Theo ca" : primaryId ? nameOf.get(primaryId)! : "Chưa giao",
      setName,
    });
  }

  if (rows.length + errors.length === 0) errors.push({ line: 0, message: "File chưa có công việc nào." });
  if (rows.length > MAX_IMPORT_ROWS) errors.push({ line: 0, message: `Mỗi lần nhập tối đa ${MAX_IMPORT_ROWS} công việc.` });
  return { rows, preview, errors };
}
