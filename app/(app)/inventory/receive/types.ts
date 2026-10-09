// Kiểu dữ liệu dùng chung giữa server action và màn hình nhập kho.

export type CatalogItem = {
  id: string;
  name: string;
  category: string;
  baseUnit: string;
  units: { name: string; factor: number }[];
};

export type SupplierOption = { id: string; name: string; paymentTermsDays: number | null };

/** Giá nhập gần nhất SAU VAT (quy về 1 đơn vị kho) của từng nguyên liệu */
export type LastPrices = Record<string, { price: number; date: string }>;

/** Một dòng trên màn hình xác nhận. Số để dạng chuỗi cho ô nhập. */
export type DraftLine = {
  key: string;
  rawName: string;
  /** null = chưa chọn; "__new" = tạo nguyên liệu mới */
  itemId: string | null;
  newItemName: string;
  newItemCategory: string;
  newItemBaseUnit: string;
  quantity: string;
  unitName: string;
  factor: string;
  unitPrice: string;
  /** Thành tiền CHƯA VAT */
  amount: string;
  /** Thuế suất VAT % */
  vatRate: string;
  matchedBy: "memory" | "ai" | null;
};

export type ReceiptDraft = {
  scanId: string | null;
  photoUrl: string | null;
  /** null = chưa chọn; "__new" = NCC mới */
  supplierId: string | null;
  newSupplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceTotal: string;
  /** Tiền thuế in trên hóa đơn (chỉ để đối chiếu) */
  printedVat: string;
  /** null = chưa rõ, người dùng phải chọn */
  paymentStatus: PaymentStatus | null;
  paidAmount: string;
  paymentMethod: "cash" | "transfer" | "other";
  dueDate: string;
  warning: string | null;
  lines: DraftLine[];
};

export type PaymentStatus = "paid" | "partial" | "unpaid";

export type ScanState = {
  ok: boolean;
  message: string;
  draft?: ReceiptDraft;
};
