"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireInventoryAccess } from "@/lib/auth/session";
import { INVOICE_PHOTO_BUCKET, fixSwappedDate, inferLineVatRates, normName } from "@/lib/inventory";
import { loadCatalog, loadSuppliers, signInvoicePhoto } from "@/lib/inventory-data";
import { extractInvoice, type InvoiceExtraction } from "@/lib/invoice-ai";
import { TASK_PHOTO_MAX_BYTES, TASK_PHOTO_TYPES } from "@/lib/task-photos";
import { vnDateString } from "@/lib/time";
import { fail, friendlyDbError, type ActionState } from "@/lib/action-state";
import type { CatalogItem, DraftLine, ReceiptDraft, ScanState, SupplierOption } from "./types";

/** Giới hạn lượt quét / người / ngày (mỗi lượt tốn phí AI). */
const MAX_SCANS_PER_DAY = 50;

/**
 * Chụp hóa đơn → AI đọc → trả bản nháp để người dùng xem lại.
 * 1. Kiểm tra quyền nhập kho tại chi nhánh (hàm DB, phiên người dùng) + giới hạn lượt quét.
 * 2. Tải ảnh lên kho riêng tư bằng secret key.
 * 3. Gọi AI với danh mục hiện có, ghi lượt quét (chi phí token) vào invoice_scans.
 * 4. Khớp tên hàng: bộ nhớ "tên trên hóa đơn → nguyên liệu" trước, rồi gợi ý của AI.
 * AI lỗi vẫn trả bản nháp trống (kèm ảnh) để nhập tay.
 */
export async function scanInvoice(branchId: string, _prev: ScanState, formData: FormData): Promise<ScanState> {
  const me = await requireInventoryAccess();
  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return { ok: false, message: "Vui lòng chụp hoặc chọn ảnh hóa đơn." };
  if (!TASK_PHOTO_TYPES.includes(photo.type)) return { ok: false, message: "Ảnh phải là JPG, PNG hoặc WEBP." };
  if (photo.size > TASK_PHOTO_MAX_BYTES) return { ok: false, message: "Ảnh quá lớn (tối đa 3,5 MB)." };

  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("can_receive_stock_at", { p_branch_id: branchId });
  if (!allowed) return { ok: false, message: "Bạn không có quyền nhập kho cho chi nhánh này." };

  const startOfDay = new Date(`${vnDateString()}T00:00:00+07:00`).toISOString();
  const { count } = await supabase
    .from("invoice_scans")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", me.id)
    .gte("created_at", startOfDay);
  if ((count ?? 0) >= MAX_SCANS_PER_DAY) {
    return { ok: false, message: `Bạn đã quét ${MAX_SCANS_PER_DAY} hóa đơn hôm nay. Vui lòng nhập tay.` };
  }

  const admin = createAdminClient();
  const buffer = Buffer.from(await photo.arrayBuffer());
  const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
  const photoPath = `${branchId}/${vnDateString().slice(0, 7)}/${randomUUID()}.${ext}`;
  const { error: uploadError } = await admin.storage
    .from(INVOICE_PHOTO_BUCKET)
    .upload(photoPath, buffer, { contentType: photo.type, upsert: false });
  if (uploadError) return { ok: false, message: "Không tải được ảnh lên. Vui lòng thử lại." };

  const [catalog, suppliers] = await Promise.all([loadCatalog(), loadSuppliers()]);
  const ai = await extractInvoice(
    { base64: buffer.toString("base64"), mediaType: photo.type as "image/jpeg" | "image/png" | "image/webp" },
    catalog.map((item, index) => ({
      no: index + 1,
      name: item.name,
      baseUnit: item.baseUnit,
      units: item.units.map((u) => `${u.name} = ${u.factor} ${item.baseUnit}`),
    })),
    suppliers.map((s) => s.name)
  );

  const { data: scan, error: scanError } = await admin
    .from("invoice_scans")
    .insert({
      branch_id: branchId,
      employee_id: me.id,
      photo_path: photoPath,
      model: ai.model,
      input_tokens: ai.inputTokens ?? null,
      output_tokens: ai.outputTokens ?? null,
      result: ai.ok ? ai.data : null,
      error: ai.ok ? null : ai.message,
    })
    .select("id")
    .single();
  if (scanError || !scan) {
    await admin.storage.from(INVOICE_PHOTO_BUCKET).remove([photoPath]);
    return { ok: false, message: "Không lưu được lượt quét. Vui lòng thử lại." };
  }

  const photoUrl = await signInvoicePhoto(photoPath);
  const emptyDraft: ReceiptDraft = {
    scanId: scan.id,
    photoUrl,
    supplierId: null,
    newSupplierName: "",
    invoiceNumber: "",
    invoiceDate: vnDateString(),
    invoiceTotal: "",
    printedVat: "",
    paymentStatus: null,
    paidAmount: "",
    paymentMethod: "cash",
    dueDate: "",
    warning: null,
    lines: [blankLine()],
  };

  if (!ai.ok) return { ok: false, message: ai.message, draft: emptyDraft };
  if (!ai.data.is_invoice || ai.data.lines.length === 0) {
    return {
      ok: false,
      message: "AI không thấy mặt hàng nào trong ảnh. Hãy chụp lại rõ, đủ sáng, thẳng hóa đơn — hoặc nhập tay bên dưới.",
      draft: emptyDraft,
    };
  }

  const { data: aliases } = await supabase.from("inventory_aliases").select("supplier_id, alias_norm, item_id, unit_name, factor");
  return { ok: true, message: "", draft: buildDraft(ai.data, emptyDraft, catalog, suppliers, aliases ?? []) };
}

function blankLine(): DraftLine {
  return {
    key: randomUUID(),
    rawName: "",
    itemId: null,
    newItemName: "",
    newItemCategory: "Khác",
    newItemBaseUnit: "",
    quantity: "",
    unitName: "",
    factor: "",
    unitPrice: "",
    amount: "",
    vatRate: "0",
    matchedBy: null,
  };
}

function num(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : String(Math.round(value * 1000) / 1000);
}

type AliasRow = { supplier_id: string | null; alias_norm: string; item_id: string; unit_name: string; factor: number };

function matchSupplier(name: string | null, suppliers: SupplierOption[]): SupplierOption | null {
  const key = normName(name);
  if (!key) return null;
  return (
    suppliers.find((s) => normName(s.name) === key) ??
    suppliers.find((s) => {
      const other = normName(s.name);
      return other.length >= 4 && key.length >= 4 && (other.includes(key) || key.includes(other));
    }) ??
    null
  );
}

/** Đơn vị trên hóa đơn → đơn vị + hệ số quy đổi đã biết của nguyên liệu (nếu có). */
function resolveUnit(item: CatalogItem, unit: string | null): { unitName: string; factor: string } {
  const key = normName(unit);
  if (!key || key === normName(item.baseUnit)) return { unitName: item.baseUnit, factor: "1" };
  const known = item.units.find((u) => normName(u.name) === key);
  if (known) return { unitName: known.name, factor: String(known.factor) };
  return { unitName: unit!.trim(), factor: "" };
}

function buildDraft(
  data: InvoiceExtraction,
  base: ReceiptDraft,
  catalog: CatalogItem[],
  suppliers: SupplierOption[],
  aliases: AliasRow[]
): ReceiptDraft {
  const supplier = matchSupplier(data.supplier_name, suppliers);
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const warnings: string[] = data.warning ? [data.warning] : [];
  const isoDate = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

  let invoiceDate = isoDate(data.invoice_date) ?? base.invoiceDate;
  const fixedDate = fixSwappedDate(invoiceDate, vnDateString());
  if (fixedDate.swapped) {
    invoiceDate = fixedDate.date;
    warnings.push(`Ngày hóa đơn được hiểu là ${invoiceDate.split("-").reverse().join("/")} (ngày/tháng) — kiểm tra lại.`);
  }

  // Thuế suất từng dòng: AI đọc được thì dùng; thiếu mà có tổng tiền thuế thì thử suy ra
  let vatRates = data.lines.map((line) => line.vat_rate);
  const subtotal = data.subtotal ?? data.lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
  const vatTotal = data.vat_amount ?? (data.total_amount && subtotal ? data.total_amount - subtotal : null);
  if (vatRates.some((rate) => rate === null) && vatTotal && vatTotal > 0 && data.lines.every((l) => l.amount !== null)) {
    const inferred = inferLineVatRates(data.lines.map((l) => l.amount!), vatTotal);
    if (inferred) {
      vatRates = inferred;
      warnings.push("Thuế suất VAT từng dòng do app suy ra từ tổng tiền thuế — kiểm tra lại.");
    } else {
      warnings.push("Chưa xác định được thuế suất VAT từng dòng — vui lòng chọn VAT cho từng dòng.");
    }
  }

  const lines = data.lines.map((line, index): DraftLine => {
    const draft: DraftLine = {
      ...blankLine(),
      rawName: line.name.trim(),
      quantity: num(line.quantity),
      unitName: line.unit?.trim() ?? "",
      unitPrice: num(line.unit_price),
      amount: num(line.amount),
      vatRate: num(vatRates[index] ?? 0) || "0",
    };
    const key = normName(line.name);

    // 1. Bộ nhớ theo đúng NCC, rồi theo NCC bất kỳ
    const alias =
      aliases.find((a) => a.alias_norm === key && a.supplier_id === (supplier?.id ?? null)) ??
      aliases.find((a) => a.alias_norm === key);
    const aliasItem = alias ? byId.get(alias.item_id) : undefined;
    if (alias && aliasItem) {
      const unit = normName(line.unit);
      const sameUnit = !unit || unit === normName(alias.unit_name);
      const resolved = sameUnit ? { unitName: alias.unit_name, factor: String(Number(alias.factor)) } : resolveUnit(aliasItem, line.unit);
      return { ...draft, itemId: aliasItem.id, ...resolved, matchedBy: "memory" };
    }

    // 2. Gợi ý của AI theo số thứ tự trong danh mục
    const aiItem = line.catalog_no ? catalog[line.catalog_no - 1] : undefined;
    if (aiItem) return { ...draft, itemId: aiItem.id, ...resolveUnit(aiItem, line.unit), matchedBy: "ai" };

    // 3. Chưa có → đề xuất tạo nguyên liệu mới
    return {
      ...draft,
      itemId: "__new",
      newItemName: line.name.trim(),
      newItemBaseUnit: line.unit?.trim() ?? "",
      factor: "1",
    };
  });

  return {
    ...base,
    supplierId: supplier ? supplier.id : data.supplier_name ? "__new" : null,
    newSupplierName: supplier ? "" : data.supplier_name?.trim() ?? "",
    invoiceNumber: data.invoice_number?.trim() ?? "",
    invoiceDate,
    invoiceTotal: num(data.total_amount),
    printedVat: vatTotal ? num(vatTotal) : "",
    paymentStatus: data.payment_status === "unknown" ? null : data.payment_status,
    paidAmount: data.payment_status === "partial" ? num(data.paid_amount) : "",
    paymentMethod: data.payment_method ?? "cash",
    dueDate: isoDate(data.due_date) ?? "",
    warning: warnings.length ? warnings.join(" ") : null,
    lines,
  };
}

// ---------------------------------------------------------------------
// LƯU PHIẾU NHẬP
// ---------------------------------------------------------------------
const lineSchema = z.object({
  item_id: z.uuid().nullable(),
  new_item: z
    .object({
      name: z.string().trim().min(1, "Chưa nhập tên nguyên liệu mới.").max(150),
      category: z.string().trim().min(1).max(50),
      base_unit: z.string().trim().min(1, "Chưa nhập đơn vị kho cho nguyên liệu mới.").max(20),
    })
    .nullable(),
  raw_name: z.string().trim().max(200).nullable(),
  quantity: z.number().positive("Số lượng phải lớn hơn 0."),
  unit_name: z.string().trim().max(20),
  factor: z.number().positive().nullable(),
  unit_price: z.number().min(0),
  amount: z.number().min(0),
  vat_rate: z.number().min(0).max(100),
});

const receiptSchema = z.object({
  branch_id: z.uuid(),
  scan_id: z.uuid().nullable(),
  supplier_id: z.uuid().nullable(),
  new_supplier_name: z.string().trim().max(150).nullable(),
  invoice_number: z.string().trim().max(50).nullable(),
  invoice_date: z.iso.date("Ngày hóa đơn không hợp lệ."),
  invoice_total: z.number().min(0).nullable(),
  note: z.string().trim().max(500).nullable(),
  payment: z.object({
    paid_amount: z.number().min(0),
    method: z.enum(["cash", "transfer", "other"]),
    due_date: z.iso.date("Hạn thanh toán không hợp lệ.").nullable(),
  }),
  lines: z.array(lineSchema).min(1, "Phiếu nhập cần ít nhất 1 dòng hàng.").max(100),
});

export type ReceiptPayload = z.infer<typeof receiptSchema>;

export async function saveReceipt(payload: ReceiptPayload): Promise<ActionState> {
  await requireInventoryAccess();
  const parsed = receiptSchema.safeParse(payload);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dữ liệu phiếu nhập không hợp lệ.");

  const supabase = await createClient();
  const { data: receiptId, error } = await supabase.rpc("create_stock_receipt", { p_payload: parsed.data });
  if (error || !receiptId) return fail(friendlyDbError(error));

  revalidatePath("/inventory");
  revalidatePath("/inventory/receipts");
  redirect(`/inventory/receipts/${receiptId}?created=1`);
}
