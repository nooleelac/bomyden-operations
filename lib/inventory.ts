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
