"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import { ITEM_CATEGORIES, formatMoney, formatQty, normName, parseVnNumber, priceChangePercent } from "@/lib/inventory";
import { initialActionState } from "@/lib/action-state";
import { saveReceipt, type ReceiptPayload } from "./actions";
import type { CatalogItem, DraftLine, LastPrices, ReceiptDraft, SupplierOption } from "./types";

type Props = {
  branchId: string;
  branchName: string;
  draft: ReceiptDraft;
  catalog: CatalogItem[];
  suppliers: SupplierOption[];
  lastPrices: LastPrices;
  onCancel: () => void;
};

const NEW = "__new";
const CUSTOM_UNIT = "__custom";
/** Cảnh báo khi giá lệch so với lần nhập trước quá mức này */
const PRICE_ALERT_PERCENT = 10;

function newLine(): DraftLine {
  return {
    key: crypto.randomUUID(),
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
    matchedBy: null,
  };
}

/** Thông tin tính toán của 1 dòng (đơn vị kho, hệ số, số lượng quy đổi, lỗi) */
function analyze(line: DraftLine, byId: Map<string, CatalogItem>) {
  const item = line.itemId && line.itemId !== NEW ? byId.get(line.itemId) : undefined;
  const baseUnit = item ? item.baseUnit : line.newItemBaseUnit.trim();
  // Nguyên liệu có sẵn mà ô đơn vị trống = đang chọn "Đơn vị khác…"
  const unitName = line.unitName.trim() || (item ? "" : baseUnit);
  const isBase = unitName !== "" && normName(unitName) === normName(baseUnit);
  const known = unitName ? item?.units.find((u) => normName(u.name) === normName(unitName)) : undefined;
  const factor = isBase ? 1 : known ? known.factor : parseVnNumber(line.factor);
  const quantity = parseVnNumber(line.quantity);
  const amount = parseVnNumber(line.amount);
  const unitPrice = parseVnNumber(line.unitPrice);
  const baseQty = quantity && factor ? quantity * factor : null;

  let error: string | null = null;
  if (!line.itemId) error = "Chọn nguyên liệu.";
  else if (line.itemId === NEW && !line.newItemName.trim()) error = "Nhập tên nguyên liệu mới.";
  else if (line.itemId === NEW && !baseUnit) error = "Nhập đơn vị kho (vd: kg).";
  else if (!quantity || quantity <= 0) error = "Nhập số lượng.";
  else if (!unitName) error = "Nhập đơn vị trên hóa đơn.";
  else if (!factor || factor <= 0) error = `Nhập quy đổi: 1 ${unitName} = ? ${baseUnit}.`;
  else if (amount === null && unitPrice === null) error = "Nhập đơn giá hoặc thành tiền.";

  const finalAmount = amount ?? (quantity && unitPrice !== null ? quantity * unitPrice : 0);
  const finalPrice = unitPrice ?? (quantity ? finalAmount / quantity : 0);
  return { item, baseUnit, unitName, isBase, known, factor, quantity, baseQty, amount: finalAmount, unitPrice: finalPrice, error };
}

export default function ReceiptForm({ branchId, branchName, draft, catalog, suppliers, lastPrices, onCancel }: Props) {
  const byId = useMemo(() => new Map(catalog.map((item) => [item.id, item])), [catalog]);
  const categories = useMemo(() => {
    const groups = new Map<string, CatalogItem[]>();
    for (const item of catalog) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    return [...groups.entries()];
  }, [catalog]);

  const [supplierId, setSupplierId] = useState(draft.supplierId ?? "");
  const [newSupplierName, setNewSupplierName] = useState(draft.newSupplierName);
  const [invoiceNumber, setInvoiceNumber] = useState(draft.invoiceNumber);
  const [invoiceDate, setInvoiceDate] = useState(draft.invoiceDate);
  const [invoiceTotal, setInvoiceTotal] = useState(draft.invoiceTotal);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(draft.lines.length ? draft.lines : [newLine()]);
  const [showErrors, setShowErrors] = useState(false);
  const [state, save, saving] = useActionState(
    (_prev: typeof initialActionState, payload: ReceiptPayload) => saveReceipt(payload),
    initialActionState
  );

  const analyzed = lines.map((line) => analyze(line, byId));
  const sum = analyzed.reduce((total, a) => total + (a.amount || 0), 0);
  const printedTotal = parseVnNumber(invoiceTotal);
  const totalMismatch = printedTotal !== null && Math.abs(printedTotal - sum) >= 1000;
  const errorCount = analyzed.filter((a) => a.error).length;

  function update(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function onItemChange(line: DraftLine, itemId: string) {
    if (itemId === NEW) {
      update(line.key, { itemId: NEW, newItemName: line.newItemName || line.rawName, matchedBy: null });
      return;
    }
    const item = byId.get(itemId);
    if (!item) return update(line.key, { itemId: null, matchedBy: null });
    // Giữ đơn vị đang có nếu nguyên liệu mới chọn cũng biết đơn vị đó; không thì về đơn vị kho
    const unit = normName(line.unitName);
    const known = item.units.find((u) => normName(u.name) === unit);
    const keepUnit = unit && unit !== normName(item.baseUnit);
    update(line.key, {
      itemId,
      matchedBy: null,
      unitName: known ? known.name : keepUnit ? line.unitName : item.baseUnit,
      factor: known ? String(known.factor) : keepUnit ? "" : "1",
    });
  }

  /** Sửa số lượng/đơn giá → tự tính thành tiền */
  function onQtyOrPrice(line: DraftLine, patch: Partial<DraftLine>) {
    const next = { ...line, ...patch };
    const q = parseVnNumber(next.quantity);
    const p = parseVnNumber(next.unitPrice);
    update(line.key, { ...patch, ...(q !== null && p !== null ? { amount: String(Math.round(q * p)) } : {}) });
  }

  function submit() {
    if (errorCount > 0 || (supplierId === NEW && !newSupplierName.trim()) || !invoiceDate) {
      setShowErrors(true);
      return;
    }
    const payload: ReceiptPayload = {
      branch_id: branchId,
      scan_id: draft.scanId,
      supplier_id: supplierId && supplierId !== NEW ? supplierId : null,
      new_supplier_name: supplierId === NEW ? newSupplierName.trim() : null,
      invoice_number: invoiceNumber.trim() || null,
      invoice_date: invoiceDate,
      invoice_total: printedTotal,
      note: note.trim() || null,
      lines: lines.map((line, i) => {
        const a = analyzed[i];
        return {
          item_id: line.itemId && line.itemId !== NEW ? line.itemId : null,
          new_item:
            line.itemId === NEW
              ? { name: line.newItemName.trim(), category: line.newItemCategory, base_unit: line.newItemBaseUnit.trim() }
              : null,
          raw_name: line.rawName.trim() || null,
          quantity: a.quantity ?? 0,
          unit_name: a.unitName,
          factor: a.factor ?? null,
          unit_price: Math.round(a.unitPrice * 100) / 100,
          amount: Math.round(a.amount * 100) / 100,
        };
      }),
    };
    startTransition(() => save(payload));
  }

  return (
    <div className="space-y-4 pb-24">
      <section className="card p-4">
        <div className="flex items-start gap-3">
          {draft.photoUrl ? (
            <a href={draft.photoUrl} target="_blank" rel="noreferrer" className="shrink-0" title="Xem ảnh lớn">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={draft.photoUrl} alt="Ảnh hóa đơn" className="h-24 w-20 rounded-lg border object-cover" />
            </a>
          ) : (
            <span className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-3xl" aria-hidden="true">✍️</span>
          )}
          <div className="min-w-0 text-sm">
            <p className="font-semibold">Kiểm tra lại trước khi lưu</p>
            <p className="mt-0.5 text-neutral-500">
              Nhập vào kho <strong className="text-neutral-800">{branchName}</strong>. Sửa những chỗ AI đọc sai, rồi bấm
              <strong className="text-neutral-800"> Lưu phiếu nhập</strong>.
            </p>
            {draft.photoUrl && <p className="mt-1 text-xs text-neutral-400">Bấm vào ảnh để phóng to so sánh.</p>}
          </div>
        </div>
        {draft.warning && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠️ AI lưu ý: {draft.warning}</p>}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Thông tin hóa đơn</h2>
        <div>
          <label htmlFor="supplier" className="mb-1 block text-sm font-medium text-neutral-700">Nhà cung cấp</label>
          <select id="supplier" className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Không rõ —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            <option value={NEW}>➕ Nhà cung cấp mới…</option>
          </select>
          {supplierId === NEW && (
            <input
              className="input mt-2"
              placeholder="Tên nhà cung cấp mới"
              value={newSupplierName}
              maxLength={150}
              onChange={(e) => setNewSupplierName(e.target.value)}
              aria-label="Tên nhà cung cấp mới"
            />
          )}
          {showErrors && supplierId === NEW && !newSupplierName.trim() && <p className="field-error">Nhập tên nhà cung cấp.</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="invoice-no" className="mb-1 block text-sm font-medium text-neutral-700">Số hóa đơn</label>
            <input id="invoice-no" className="input" value={invoiceNumber} maxLength={50} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div>
            <label htmlFor="invoice-date" className="mb-1 block text-sm font-medium text-neutral-700">Ngày hóa đơn</label>
            <input id="invoice-date" type="date" className="input" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
          </div>
        </div>
        <div>
          <label htmlFor="invoice-total" className="mb-1 block text-sm font-medium text-neutral-700">Tổng tiền in trên hóa đơn</label>
          <input
            id="invoice-total"
            className="input"
            inputMode="decimal"
            value={invoiceTotal}
            onChange={(e) => setInvoiceTotal(e.target.value)}
            placeholder="Để đối chiếu, có thể bỏ trống"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 font-semibold">Mặt hàng ({lines.length})</h2>
        {lines.map((line, index) => {
          const a = analyzed[index];
          const last = a.item ? lastPrices[a.item.id] : undefined;
          const perBase = a.baseQty ? a.amount / a.baseQty : null;
          const change = priceChangePercent(last?.price, perBase);
          return (
            <div key={line.key} className={`card space-y-3 p-4 ${showErrors && a.error ? "border-red-300" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-sm">
                  <span className="font-semibold text-neutral-400">#{index + 1}</span>{" "}
                  {line.rawName ? (
                    <span className="text-neutral-600">Trên hóa đơn: <strong className="text-neutral-900">{line.rawName}</strong></span>
                  ) : (
                    <span className="text-neutral-500">Dòng nhập tay</span>
                  )}
                  {line.matchedBy === "memory" && <span className="ml-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">✓ Đã nhớ</span>}
                  {line.matchedBy === "ai" && <span className="ml-1.5 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">AI gợi ý</span>}
                  {line.itemId === NEW && <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Mới</span>}
                </div>
                <button
                  type="button"
                  className="-m-1 shrink-0 rounded-lg p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                  aria-label={`Xóa dòng ${index + 1}`}
                >
                  🗑️
                </button>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600" htmlFor={`item-${line.key}`}>Nguyên liệu trong kho</label>
                <select
                  id={`item-${line.key}`}
                  className="input"
                  value={line.itemId ?? ""}
                  onChange={(e) => onItemChange(line, e.target.value)}
                >
                  <option value="">— Chọn nguyên liệu —</option>
                  {categories.map(([category, items]) => (
                    <optgroup key={category} label={category}>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>{item.name} ({item.baseUnit})</option>
                      ))}
                    </optgroup>
                  ))}
                  <option value={NEW}>➕ Tạo nguyên liệu mới…</option>
                </select>
              </div>

              {line.itemId === NEW && (
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-amber-50/60 p-3">
                  <input
                    className="input col-span-2"
                    placeholder="Tên nguyên liệu (vd: Thăn bò Úc)"
                    value={line.newItemName}
                    maxLength={150}
                    onChange={(e) => update(line.key, { newItemName: e.target.value })}
                    aria-label="Tên nguyên liệu mới"
                  />
                  <select
                    className="input"
                    value={line.newItemCategory}
                    onChange={(e) => update(line.key, { newItemCategory: e.target.value })}
                    aria-label="Nhóm"
                  >
                    {ITEM_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder="Đơn vị kho (kg, chai…)"
                    value={line.newItemBaseUnit}
                    maxLength={20}
                    onChange={(e) => update(line.key, { newItemBaseUnit: e.target.value })}
                    aria-label="Đơn vị kho"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600" htmlFor={`qty-${line.key}`}>Số lượng</label>
                  <input
                    id={`qty-${line.key}`}
                    className="input"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => onQtyOrPrice(line, { quantity: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600" htmlFor={`unit-${line.key}`}>Đơn vị trên hóa đơn</label>
                  {a.item && (a.isBase || a.known) ? (
                    <select
                      id={`unit-${line.key}`}
                      className="input"
                      value={a.isBase ? a.item.baseUnit : a.known!.name}
                      onChange={(e) => {
                        if (e.target.value === CUSTOM_UNIT) return update(line.key, { unitName: "", factor: "" });
                        const unit = a.item!.units.find((u) => u.name === e.target.value);
                        update(line.key, { unitName: e.target.value, factor: unit ? String(unit.factor) : "1" });
                      }}
                    >
                      <option value={a.item.baseUnit}>{a.item.baseUnit}</option>
                      {a.item.units.map((u) => (
                        <option key={u.name} value={u.name}>{u.name} (= {formatQty(u.factor)} {a.item!.baseUnit})</option>
                      ))}
                      <option value={CUSTOM_UNIT}>Đơn vị khác…</option>
                    </select>
                  ) : (
                    <input
                      id={`unit-${line.key}`}
                      className="input"
                      placeholder={a.baseUnit || "kg, thùng…"}
                      value={line.unitName}
                      maxLength={20}
                      onChange={(e) => update(line.key, { unitName: e.target.value })}
                    />
                  )}
                </div>
              </div>

              {a.baseUnit && !a.isBase && !a.known && line.unitName.trim() && (
                <div className="flex items-center gap-2 rounded-lg bg-sky-50 p-3 text-sm">
                  <span className="shrink-0">1 {a.unitName} =</span>
                  <input
                    className="input w-24"
                    inputMode="decimal"
                    value={line.factor}
                    onChange={(e) => update(line.key, { factor: e.target.value })}
                    aria-label={`Quy đổi 1 ${a.unitName} ra ${a.baseUnit}`}
                  />
                  <span className="shrink-0">{a.baseUnit}</span>
                  <span className="text-xs text-sky-700">(app sẽ nhớ cho lần sau)</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600" htmlFor={`price-${line.key}`}>Đơn giá</label>
                  <input
                    id={`price-${line.key}`}
                    className="input"
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(e) => onQtyOrPrice(line, { unitPrice: e.target.value })}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600" htmlFor={`amount-${line.key}`}>Thành tiền</label>
                  <input
                    id={`amount-${line.key}`}
                    className="input"
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(e) => update(line.key, { amount: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-neutral-500">
                <span>
                  {a.baseQty ? <>Cộng kho: <strong className="text-neutral-800">{formatQty(a.baseQty)} {a.baseUnit}</strong></> : "—"}
                </span>
                <span className="tabular-nums">{formatMoney(a.amount)}</span>
              </div>
              {change !== null && Math.abs(change) >= PRICE_ALERT_PERCENT && (
                <p className={`rounded-md px-2 py-1 text-xs ${change > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                  {change > 0 ? "▲ Giá tăng" : "▼ Giá giảm"} {Math.abs(change).toFixed(0)}% so với lần nhập trước (
                  {formatMoney(last!.price)}/{a.baseUnit})
                </p>
              )}
              {showErrors && a.error && <p className="field-error mt-0">{a.error}</p>}
            </div>
          );
        })}
        <button type="button" className="btn-secondary w-full" onClick={() => setLines((current) => [...current, newLine()])}>
          + Thêm dòng hàng
        </button>
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">Tổng các dòng</span>
          <span className="text-lg font-bold tabular-nums">{formatMoney(sum)}</span>
        </div>
        {totalMismatch && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ⚠️ Lệch {formatMoney(Math.abs(printedTotal! - sum))} so với tổng in trên hóa đơn ({formatMoney(printedTotal)}). Kiểm tra
            lại các dòng (có thể do thuế/chiết khấu).
          </p>
        )}
        <div>
          <label htmlFor="note" className="mb-1 block text-sm font-medium text-neutral-700">Ghi chú</label>
          <textarea id="note" className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </section>

      {state.message && !state.ok && <p className="alert-error">{state.message}</p>}
      {showErrors && errorCount > 0 && <p className="alert-error">Còn {errorCount} dòng chưa đủ thông tin (viền đỏ).</p>}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>Hủy</button>
          <button type="button" className="btn-primary flex-1" onClick={submit} disabled={saving || lines.length === 0}>
            {saving ? "Đang lưu..." : `Lưu phiếu nhập · ${formatMoney(sum)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
