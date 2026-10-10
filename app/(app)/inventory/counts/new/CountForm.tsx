"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatQty, matchesSearch, parseVnNumber } from "@/lib/inventory";
import type { CatalogItem } from "../../receive/types";
import { createStockCount } from "../../stock-actions";

type Entry = { qty: string; unit: string };

const draftKey = (branchId: string) => `bomyden-count-draft-${branchId}`;

function readDraft(branchId: string): { entries: Record<string, Entry>; note: string } {
  try {
    const raw = localStorage.getItem(draftKey(branchId));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { entries: {}, note: "" };
}

function writeDraft(branchId: string, entries: Record<string, Entry>, note: string) {
  try {
    if (Object.keys(entries).length === 0 && !note) localStorage.removeItem(draftKey(branchId));
    else localStorage.setItem(draftKey(branchId), JSON.stringify({ entries, note }));
  } catch {}
}

/** Phiếu kiểm kê: nhập số đếm (không hiện tồn trên sổ để đếm khách quan). Nháp tự lưu trên máy. */
export default function CountForm({
  branchId,
  branchName,
  catalog,
  stockedIds,
}: {
  branchId: string;
  branchName: string;
  catalog: CatalogItem[];
  stockedIds: string[];
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [onlyStocked, setOnlyStocked] = useState(stockedIds.length > 0);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const stocked = useMemo(() => new Set(stockedIds), [stockedIds]);

  // Khôi phục nháp sau khi hiển thị (localStorage chỉ có ở trình duyệt)
  useEffect(() => {
    const draft = readDraft(branchId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đồng bộ một lần từ localStorage
    setEntries(draft.entries);
    setNote(draft.note);
  }, [branchId]);

  const update = (next: Record<string, Entry>, nextNote = note) => {
    setEntries(next);
    writeDraft(branchId, next, nextNote);
  };

  const setEntry = (item: CatalogItem, patch: Partial<Entry>) => {
    const current = entries[item.id] ?? { qty: "", unit: item.baseUnit };
    const merged = { ...current, ...patch };
    const next = { ...entries };
    if (merged.qty.trim() === "") delete next[item.id];
    else next[item.id] = merged;
    update(next);
  };

  const groups = useMemo(() => {
    const q = query.trim();
    const map = new Map<string, CatalogItem[]>();
    for (const item of catalog) {
      if (q && !matchesSearch(item.name, q)) continue;
      if (!q && onlyStocked && !stocked.has(item.id) && !entries[item.id]) continue;
      map.set(item.category, [...(map.get(item.category) ?? []), item]);
    }
    return [...map.entries()];
  }, [catalog, query, onlyStocked, stocked, entries]);

  const filled = Object.keys(entries).length;

  const toLines = () => {
    const lines: { itemId: string; countedQty: number }[] = [];
    for (const item of catalog) {
      const entry = entries[item.id];
      if (!entry) continue;
      const qty = parseVnNumber(entry.qty);
      if (qty === null || qty < 0) throw new Error(`"${item.name}": số đếm không hợp lệ.`);
      const factor = entry.unit === item.baseUnit ? 1 : item.units.find((u) => u.name === entry.unit)?.factor ?? 1;
      lines.push({ itemId: item.id, countedQty: Math.round(qty * factor * 10000) / 10000 });
    }
    return lines;
  };

  const submit = () => {
    setError("");
    let lines;
    try {
      lines = toLines();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (lines.length === 0) {
      setError("Chưa nhập số đếm cho nguyên liệu nào.");
      return;
    }
    if (!confirm(`Lưu kiểm kê ${lines.length} nguyên liệu tại ${branchName}? Tồn kho sẽ được đặt bằng số đếm.`)) return;
    startTransition(async () => {
      const result = await createStockCount({ branchId, note, lines });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      writeDraft(branchId, {}, "");
      router.push(`/inventory/counts/${result.id}`);
    });
  };

  if (catalog.length === 0) {
    return <p className="card p-8 text-center text-neutral-500">Chưa có nguyên liệu nào trong danh mục.</p>;
  }

  return (
    <div className="pb-24">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="search"
          className="input max-w-xs"
          placeholder="Tìm nguyên liệu..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Tìm nguyên liệu"
        />
        {stockedIds.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-neutral-600">
            <input type="checkbox" checked={onlyStocked} onChange={(e) => setOnlyStocked(e.target.checked)} className="h-4 w-4" />
            Chỉ nguyên liệu đã có ở chi nhánh
          </label>
        )}
      </div>

      <div className="space-y-4">
        {groups.map(([category, items]) => (
          <section key={category} className="card overflow-hidden">
            <h2 className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-600">{category}</h2>
            <ul className="divide-y divide-neutral-100">
              {items.map((item) => {
                const entry = entries[item.id];
                const unit = entry?.unit ?? item.baseUnit;
                const factor = unit === item.baseUnit ? 1 : item.units.find((u) => u.name === unit)?.factor ?? 1;
                const qty = entry ? parseVnNumber(entry.qty) : null;
                return (
                  <li key={item.id} className={`flex items-center gap-3 px-4 py-2.5 ${entry ? "bg-emerald-50/50" : ""}`}>
                    <label htmlFor={`c-${item.id}`} className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-sm font-medium">{item.name}</span>
                      {entry && factor !== 1 && qty !== null && (
                        <span className="block text-xs text-neutral-500">= {formatQty(qty * factor)} {item.baseUnit}</span>
                      )}
                    </label>
                    <input
                      id={`c-${item.id}`}
                      className="input w-20 shrink-0 text-right tabular-nums"
                      aria-label={`Số đếm ${item.name}`}
                      inputMode="decimal"
                      placeholder="—"
                      value={entry?.qty ?? ""}
                      onChange={(e) => setEntry(item, { qty: e.target.value })}
                    />
                    {item.units.length > 0 ? (
                      <select
                        className="input w-20 shrink-0 px-2"
                        value={unit}
                        onChange={(e) => setEntry(item, { unit: e.target.value, qty: entry?.qty ?? "" })}
                        aria-label={`Đơn vị đếm ${item.name}`}
                      >
                        <option value={item.baseUnit}>{item.baseUnit}</option>
                        {item.units.map((u) => (
                          <option key={u.name} value={u.name}>{u.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="w-20 shrink-0 text-sm text-neutral-500">{item.baseUnit}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {groups.length === 0 && <p className="text-sm text-neutral-500">Không tìm thấy nguyên liệu phù hợp.</p>}
      </div>

      <div className="mt-4">
        <label htmlFor="count-note" className="mb-1.5 block text-sm font-medium text-neutral-700">Ghi chú (tùy chọn)</label>
        <input
          id="count-note"
          className="input"
          maxLength={500}
          placeholder="vd: Kiểm kê cuối tuần"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            writeDraft(branchId, entries, e.target.value);
          }}
        />
      </div>

      <div className="fixed inset-x-0 bottom-(--nav-h) z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <p className="font-medium">Đã nhập {filled} nguyên liệu</p>
            {error ? <p className="truncate text-red-600">{error}</p> : <p className="text-xs text-neutral-500">Nháp được tự lưu trên máy này</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            {filled > 0 && (
              <button type="button" className="btn-secondary" onClick={() => confirm("Xóa hết số đã nhập?") && update({}, note)} disabled={pending}>
                Xóa
              </button>
            )}
            <button type="button" className="btn-primary" onClick={submit} disabled={pending || filled === 0}>
              {pending ? "Đang lưu..." : "Lưu kiểm kê"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
