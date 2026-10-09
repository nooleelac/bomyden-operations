"use client";

import { useMemo, useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { formatMoney, formatQty, matchesSearch } from "@/lib/inventory";
import { adjustStock } from "./actions";
import { setStockMin } from "./stock-actions";

export type StockRow = {
  id: string;
  name: string;
  category: string;
  baseUnit: string;
  quantity: number;
  minQuantity: number | null;
  updatedAt: string | null;
  lastPrice: number | null;
};

const isLow = (r: StockRow) => r.minQuantity !== null && r.quantity < r.minQuantity;

export default function StockView({
  branchId,
  rows,
  canAdjust,
  initialLowOnly = false,
}: {
  branchId: string;
  rows: StockRow[];
  canAdjust: boolean;
  initialLowOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(initialLowOnly);
  const [adjusting, setAdjusting] = useState<StockRow | null>(null);
  const [settingMin, setSettingMin] = useState<StockRow | null>(null);
  const [message, setMessage] = useState("");

  const groups = useMemo(() => {
    const q = query.trim();
    const map = new Map<string, StockRow[]>();
    for (const row of rows) {
      if (q && !matchesSearch(row.name, q)) continue;
      if (lowOnly && !isLow(row)) continue;
      map.set(row.category, [...(map.get(row.category) ?? []), row]);
    }
    return [...map.entries()];
  }, [rows, query, lowOnly]);
  const lowCount = rows.filter(isLow).length;

  const stockValue = rows.reduce((total, r) => total + (r.lastPrice && r.quantity > 0 ? r.lastPrice * r.quantity : 0), 0);

  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center text-neutral-500">
        <p className="text-4xl" aria-hidden="true">📦</p>
        <p className="mt-2 font-medium text-neutral-700">Kho chưa có nguyên liệu nào</p>
        <p className="mt-1 text-sm">Chụp hóa đơn nhập hàng đầu tiên — nguyên liệu sẽ được tạo ngay khi lưu phiếu.</p>
      </div>
    );
  }

  return (
    <div>
      {message && <p className="alert-success mb-4">{message}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="input max-w-xs"
          placeholder="Tìm nguyên liệu..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Tìm nguyên liệu"
        />
        <button
          type="button"
          onClick={() => setLowOnly((v) => !v)}
          className={`rounded-full border px-3 py-1.5 text-sm font-medium ${lowOnly ? "border-red-600 bg-red-600 text-white" : lowCount ? "border-red-200 bg-red-50 text-red-700" : "border-neutral-300 bg-white text-neutral-600"}`}
          aria-pressed={lowOnly}
        >
          ⚠️ Dưới mức tối thiểu ({lowCount})
        </button>
        <p className="text-sm text-neutral-500">
          {rows.length} nguyên liệu · Giá trị ước tính <strong className="text-neutral-800">{formatMoney(stockValue)}</strong>
        </p>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        Tồn kho = lần kiểm kê gần nhất + nhập − xuất. Hàng dùng hằng ngày được trừ khi kiểm kê.{canAdjust && " Bấm vào số tối thiểu để đặt mức cảnh báo tồn thấp."}
      </p>

      <div className="space-y-4">
        {groups.map(([category, items]) => (
          <section key={category} className="card overflow-hidden">
            <h2 className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-600">{category}</h2>
            <ul className="divide-y divide-neutral-100">
              {items.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.name}</p>
                    <p className="text-xs text-neutral-500">
                      {row.lastPrice ? `Giá gần nhất ${formatMoney(row.lastPrice)}/${row.baseUnit}` : "Chưa có giá"}
                      {" · "}
                      {canAdjust ? (
                        <button type="button" className={`underline decoration-dotted ${isLow(row) ? "font-semibold text-red-700" : ""}`} onClick={() => setSettingMin(row)}>
                          {row.minQuantity === null ? "Đặt tối thiểu" : `Tối thiểu ${formatQty(row.minQuantity)}`}
                        </button>
                      ) : (
                        row.minQuantity !== null && <span className={isLow(row) ? "font-semibold text-red-700" : ""}>Tối thiểu {formatQty(row.minQuantity)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <p className={`text-right font-semibold tabular-nums ${row.quantity < 0 || isLow(row) ? "text-red-600" : row.quantity === 0 ? "text-neutral-400" : ""}`}>
                      {formatQty(row.quantity)} <span className="text-sm font-normal text-neutral-500">{row.baseUnit}</span>
                    </p>
                    {canAdjust && (
                      <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setAdjusting(row)}>
                        Điều chỉnh
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="text-sm text-neutral-500">{lowOnly ? "Không có nguyên liệu nào dưới mức tối thiểu." : "Không tìm thấy nguyên liệu phù hợp."}</p>
        )}
      </div>

      {settingMin && (
        <MinDialog
          branchId={branchId}
          row={settingMin}
          onClose={() => setSettingMin(null)}
          onDone={(msg) => {
            setSettingMin(null);
            setMessage(msg);
          }}
        />
      )}
      {adjusting && (
        <AdjustDialog
          branchId={branchId}
          row={adjusting}
          onClose={() => setAdjusting(null)}
          onDone={(msg) => {
            setAdjusting(null);
            setMessage(msg);
          }}
        />
      )}
    </div>
  );
}

function AdjustDialog({ branchId, row, onClose, onDone }: { branchId: string; row: StockRow; onClose: () => void; onDone: (m: string) => void }) {
  const [state, action, pending] = useFormAction(adjustStock.bind(null, branchId, row.id), (r) => onDone(r.message));
  return (
    <Dialog open onClose={onClose} title="Điều chỉnh tồn kho" description={`${row.name} — đang ghi nhận ${formatQty(row.quantity)} ${row.baseUnit}`}>
      <ActionForm action={action} className="space-y-4">
        <div>
          <label htmlFor="adj-qty" className="mb-1.5 block text-sm font-medium text-neutral-700">Số tồn thực tế ({row.baseUnit})</label>
          <input id="adj-qty" name="quantity" className="input" inputMode="decimal" required autoFocus />
          {state.fieldErrors?.quantity && <p className="field-error">{state.fieldErrors.quantity}</p>}
        </div>
        <div>
          <label htmlFor="adj-reason" className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do</label>
          <input id="adj-reason" name="reason" className="input" placeholder="vd: Kiểm kho cuối ngày, hàng hỏng..." required maxLength={500} />
          {state.fieldErrors?.reason && <p className="field-error">{state.fieldErrors.reason}</p>}
        </div>
        {state.message && !state.ok && !state.fieldErrors && <p className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Hủy</button>
          <SubmitButton pending={pending}>Lưu số tồn</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

function MinDialog({ branchId, row, onClose, onDone }: { branchId: string; row: StockRow; onClose: () => void; onDone: (m: string) => void }) {
  const [state, action, pending] = useFormAction(setStockMin.bind(null, branchId, row.id), (r) => onDone(r.message));
  return (
    <Dialog
      open
      onClose={onClose}
      title="Mức tồn tối thiểu"
      description={`${row.name} — đang tồn ${formatQty(row.quantity)} ${row.baseUnit}. Dưới mức này sẽ hiện cảnh báo và gửi thông báo cho Quản lý lúc 9:00 sáng.`}
    >
      <ActionForm action={action} className="space-y-4">
        <div>
          <label htmlFor="min-qty" className="mb-1.5 block text-sm font-medium text-neutral-700">Tối thiểu ({row.baseUnit})</label>
          <input
            id="min-qty"
            name="min"
            className="input"
            inputMode="decimal"
            defaultValue={row.minQuantity === null ? "" : formatQty(row.minQuantity)}
            placeholder="Để trống = không cảnh báo"
            autoFocus
          />
          {state.fieldErrors?.min && <p className="field-error">{state.fieldErrors.min}</p>}
        </div>
        {state.message && !state.ok && !state.fieldErrors && <p className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Hủy</button>
          <SubmitButton pending={pending}>Lưu</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
