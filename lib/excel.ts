import "server-only";

import ExcelJS from "exceljs";

// Tạo file Excel (.xlsx) cho các trang xuất dữ liệu. Mọi ngày giờ hiển thị theo giờ Việt Nam.

export type ColumnType = "text" | "money" | "qty" | "int" | "percent" | "date" | "datetime" | "hours";

export type Column<Row> = {
  header: string;
  width?: number;
  type?: ColumnType;
  value: (row: Row) => string | number | null | undefined;
  /** Cộng dồn ở dòng tổng (chỉ cột số) */
  total?: boolean;
};

const NUM_FORMATS: Partial<Record<ColumnType, string>> = {
  money: "#,##0",
  qty: "#,##0.###",
  int: "#,##0",
  percent: '0.##"%"',
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm",
  hours: "#,##0.00",
};

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Excel không có múi giờ → đổi mốc thời gian ISO sang "giờ Việt Nam" dạng Date UTC để hiển thị đúng. */
function toExcelDate(value: string, type: "date" | "datetime"): Date {
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00Z`);
  return new Date(new Date(value).getTime() + VN_OFFSET_MS);
}

export function createWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bò Mỹ Đen";
  workbook.created = new Date();
  return workbook;
}

/**
 * Thêm 1 sheet dạng bảng: (tiêu đề + dòng mô tả) → dòng tiêu đề cột in đậm, cố định → dữ liệu → dòng tổng (nếu có).
 */
export function addSheet<Row>(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Column<Row>[],
  rows: Row[],
  options: { title?: string; subtitle?: string } = {}
): ExcelJS.Worksheet {
  // Tên sheet tối đa 31 ký tự, không chứa : \ / ? * [ ]
  const sheet = workbook.addWorksheet(name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31));
  let headerRow = 1;
  if (options.title) {
    sheet.getCell(1, 1).value = options.title;
    sheet.getCell(1, 1).font = { bold: true, size: 14 };
    headerRow = 2;
    if (options.subtitle) {
      sheet.getCell(2, 1).value = options.subtitle;
      sheet.getCell(2, 1).font = { italic: true, color: { argb: "FF6B7280" } };
      headerRow = 3;
    }
    headerRow += 1; // 1 dòng trống
  }

  const header = sheet.getRow(headerRow);
  columns.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF171717" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    sheet.getColumn(i + 1).width = col.width ?? Math.max(12, col.header.length + 2);
  });
  header.height = 22;
  sheet.views = [{ state: "frozen", ySplit: headerRow }];

  rows.forEach((row, r) => {
    const excelRow = sheet.getRow(headerRow + 1 + r);
    columns.forEach((col, i) => {
      const raw = col.value(row);
      const cell = excelRow.getCell(i + 1);
      const type = col.type ?? "text";
      if (raw === null || raw === undefined || raw === "") {
        cell.value = null;
      } else if (type === "date" || type === "datetime") {
        cell.value = typeof raw === "string" ? toExcelDate(raw, type) : raw;
      } else if (type === "text") {
        cell.value = String(raw);
      } else {
        cell.value = Number(raw);
      }
      const fmt = NUM_FORMATS[type];
      if (fmt) cell.numFmt = fmt;
    });
  });

  if (columns.some((c) => c.total) && rows.length > 0) {
    const totalRow = sheet.getRow(headerRow + rows.length + 1);
    totalRow.getCell(1).value = "TỔNG CỘNG";
    columns.forEach((col, i) => {
      if (!col.total) return;
      const sum = rows.reduce((acc, row) => acc + Number(col.value(row) ?? 0), 0);
      const cell = totalRow.getCell(i + 1);
      cell.value = Math.round(sum * 1000) / 1000;
      const fmt = NUM_FORMATS[col.type ?? "money"];
      if (fmt) cell.numFmt = fmt;
    });
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.border = { top: { style: "thin" } };
    });
  }

  if (rows.length > 0) {
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow + rows.length, column: columns.length },
    };
  }
  return sheet;
}

/** Trả file Excel về trình duyệt (tên file có dấu tiếng Việt) */
export async function excelResponse(workbook: ExcelJS.Workbook, filename: string): Promise<Response> {
  const buffer = await workbook.xlsx.writeBuffer();
  const ascii = filename.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^\w.-]+/g, "_");
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

/** Tháng dạng YYYY-MM từ query, mặc định tháng hiện tại; trả kèm khoảng [from, to) */
export function monthRange(param: string | null, today: string): { month: string; from: string; to: string } {
  const month = param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { month, from: `${month}-01`, to: `${next}-01` };
}
