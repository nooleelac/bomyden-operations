// Hằng số & định dạng dùng chung cho module Kho (dùng được cả server lẫn client).

export const INVOICE_PHOTO_BUCKET = "invoice-photos";

export const ITEM_CATEGORIES = ["Thịt", "Hải sản", "Rau củ", "Gia vị", "Đồ khô", "Đồ uống", "Vật dụng", "Khác"];

const qtyFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 });
const moneyFormat = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

/** 1.234,5 */
export function formatQty(value: number | string | null | undefined): string {
  return qtyFormat.format(Number(value ?? 0));
}

/** 1.250.000 đ */
export function formatMoney(value: number | string | null | undefined): string {
  return `${moneyFormat.format(Math.round(Number(value ?? 0)))} đ`;
}

/** Chuẩn hóa tên để so khớp (khớp private.norm_name ở DB). */
export function normName(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Đọc số người dùng gõ theo kiểu Việt Nam: "1.250.000" → 1250000, "2,5" → 2.5, "1.5" → 1.5.
 * Trả về null nếu không phải số.
 */
export function parseVnNumber(input: string): number | null {
  let s = input.trim().replace(/\s|đ|₫|vnd/gi, "");
  if (!s) return null;
  if (s.includes(",")) {
    // Dấu phẩy là phần thập phân → dấu chấm là phân cách nghìn
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Đơn giá quy về 1 đơn vị kho */
export function pricePerBaseUnit(amount: number, baseQuantity: number): number | null {
  return baseQuantity > 0 ? amount / baseQuantity : null;
}

/** % chênh lệch giá mới so với giá cũ (null nếu không so được) */
export function priceChangePercent(oldPrice: number | null | undefined, newPrice: number | null | undefined): number | null {
  if (!oldPrice || !newPrice || oldPrice <= 0) return null;
  return ((newPrice - oldPrice) / oldPrice) * 100;
}

/** Tiền thuế 1 dòng (làm tròn đến đồng, khớp hàm DB create_stock_receipt) */
export function lineVat(amount: number, ratePercent: number): number {
  return Math.round((amount * ratePercent) / 100);
}

const VAT_CANDIDATES = [5, 8, 10];

/**
 * Hóa đơn có tổng tiền thuế nhưng không ghi thuế suất từng dòng → thử suy ra:
 * 1 thuế suất chung cho mọi dòng, hoặc 2 thuế suất (mỗi dòng 1 trong 2). Chỉ trả kết quả khi có DUY NHẤT 1 cách khớp
 * (sai số làm tròn ≤ số dòng). Không suy ra được → null.
 */
export function inferLineVatRates(amounts: number[], vatTotal: number): number[] | null {
  if (amounts.length === 0 || vatTotal <= 0) return null;
  const tolerance = Math.max(2, amounts.length);
  const total = (rates: number[]) => amounts.reduce((sum, a, i) => sum + lineVat(a, rates[i]), 0);

  for (const rate of VAT_CANDIDATES) {
    const rates = amounts.map(() => rate);
    if (Math.abs(total(rates) - vatTotal) <= tolerance) return rates;
  }
  if (amounts.length > 14) return null;

  const matches: number[][] = [];
  for (let a = 0; a < VAT_CANDIDATES.length; a++) {
    for (let b = a + 1; b < VAT_CANDIDATES.length; b++) {
      // mask: bit = 1 → thuế suất b, 0 → thuế suất a (bỏ trường hợp tất cả cùng 1 thuế suất)
      for (let mask = 1; mask < (1 << amounts.length) - 1; mask++) {
        const rates = amounts.map((_, i) => (mask & (1 << i) ? VAT_CANDIDATES[b] : VAT_CANDIDATES[a]));
        if (Math.abs(total(rates) - vatTotal) <= tolerance) {
          matches.push(rates);
          if (matches.length > 1) return null;
        }
      }
    }
  }
  return matches[0] ?? null;
}

/**
 * AI đôi khi đọc ngày kiểu Mỹ (03/10 → 10 tháng 3). Nếu ngày đọc được nằm ngoài khoảng hợp lý
 * (quá 45 ngày trước hoặc sau hôm nay) mà đảo ngày ↔ tháng lại hợp lý → dùng ngày đã đảo.
 */
export function fixSwappedDate(date: string, today: string): { date: string; swapped: boolean } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return { date, swapped: false };
  const dayMs = 86_400_000;
  const t = Date.parse(`${today}T00:00:00Z`);
  const plausible = (iso: string) => {
    const v = Date.parse(`${iso}T00:00:00Z`);
    return Number.isFinite(v) && v <= t + dayMs && v >= t - 45 * dayMs;
  };
  if (plausible(date)) return { date, swapped: false };
  const [, y, month, day] = m;
  if (Number(day) > 12) return { date, swapped: false };
  const swapped = `${y}-${day}-${month}`;
  return plausible(swapped) ? { date: swapped, swapped: true } : { date, swapped: false };
}

export const PAYMENT_METHOD_LABELS = { cash: "Tiền mặt", transfer: "Chuyển khoản", other: "Khác" } as const;

/** Nhãn tình trạng thanh toán của 1 phiếu nhập */
export function paymentBadge(
  receipt: {
    status: string;
    paid_amount: number | string;
    debt_amount: number | string | null;
    due_date: string | null;
  },
  today: string
): { label: string; className: string; overdue: boolean } {
  if (receipt.status === "cancelled") return { label: "Đã hủy", className: "bg-neutral-100 text-neutral-500", overdue: false };
  const debt = Number(receipt.debt_amount ?? 0);
  if (debt <= 0) return { label: "Đã trả đủ", className: "bg-emerald-50 text-emerald-700", overdue: false };
  const overdue = Boolean(receipt.due_date && receipt.due_date < today);
  if (overdue) return { label: "Quá hạn", className: "bg-red-50 text-red-700", overdue };
  return Number(receipt.paid_amount) > 0
    ? { label: "Trả một phần", className: "bg-amber-50 text-amber-700", overdue }
    : { label: "Chưa trả", className: "bg-amber-50 text-amber-700", overdue };
}

/** "2026-10-03" → "03/10/2026" */
export function formatIsoDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}
