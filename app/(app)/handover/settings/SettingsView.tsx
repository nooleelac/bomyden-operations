"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { matchesSearch } from "@/lib/inventory";
import type { CatalogItem } from "../../inventory/receive/types";
import { addHandoverItem, moveHandoverItem, removeHandoverItem, updateHandoverItem, type SaveResult } from "../actions";

type Row = { id: string; itemId: string; unit: string; requiresPhoto: boolean };

export default function SettingsView({ branchId, catalog, rows }: { branchId: string; catalog: CatalogItem[]; rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const used = new Set(rows.map((r) => r.itemId));

  const run = (action: () => Promise<SaveResult>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.message ? { ok: result.ok, text: result.message } : null);
      if (result.ok) router.refresh();
    });

  const unitsOf = (item: CatalogItem | undefined) => (item ? [item.baseUnit, ...item.units.map((u) => u.name)] : []);

  const candidates = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return catalog.filter((c) => !used.has(c.id) && matchesSearch(c.name, q)).slice(0, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- used suy ra từ rows
  }, [catalog, query, rows]);

  return (
    <div className="space-y-5">
      {message && <p role="status" className={message.ok ? "alert-success" : "alert-error"}>{message.text}</p>}

      <section className="card overflow-hidden">
        <h2 className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-600">
          Đang bàn giao ({rows.length} món)
        </h2>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-500">Chưa có món nào — tìm và thêm ở bên dưới.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((row, index) => {
              const item = byId.get(row.itemId);
              const units = unitsOf(item);
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      className="px-1 text-xs text-neutral-500 disabled:opacity-30"
                      aria-label="Lên trên"
                      disabled={pending || index === 0}
                      onClick={() => run(() => moveHandoverItem(row.id, -1))}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="px-1 text-xs text-neutral-500 disabled:opacity-30"
                      aria-label="Xuống dưới"
                      disabled={pending || index === rows.length - 1}
                      onClick={() => run(() => moveHandoverItem(row.id, 1))}
                    >
                      ▼
                    </button>
                  </div>
                  <p className="min-w-0 flex-1 text-sm font-medium">{item?.name ?? "(nguyên liệu đã ngừng dùng)"}</p>
                  {units.length > 1 ? (
                    <select
                      className="input w-24 px-2"
                      aria-label="Đơn vị ghi"
                      value={row.unit}
                      disabled={pending}
                      onChange={(e) => run(() => updateHandoverItem(row.id, { unit: e.target.value }))}
                    >
                      {units.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="w-24 text-sm text-neutral-500">{row.unit}</span>
                  )}
                  <label className="flex items-center gap-1.5 text-sm text-neutral-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={row.requiresPhoto}
                      disabled={pending}
                      onChange={(e) => run(() => updateHandoverItem(row.id, { requiresPhoto: e.target.checked }))}
                    />
                    Bắt buộc ảnh
                  </label>
                  <button
                    type="button"
                    className="text-sm text-red-600 hover:underline disabled:opacity-50"
                    disabled={pending}
                    onClick={() => confirm(`Bỏ "${item?.name ?? "món này"}" khỏi danh sách bàn giao?`) && run(() => removeHandoverItem(row.id))}
                  >
                    Bỏ
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">Thêm món</h2>
        {catalog.length === 0 ? (
          <p className="text-sm text-neutral-500">Danh mục nguyên liệu đang trống — thêm nguyên liệu ở Kho trước.</p>
        ) : (
          <>
            <input
              type="search"
              className="input"
              placeholder="Tìm nguyên liệu (vd: thăn, lõi vai, khoai tây)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Tìm nguyên liệu"
            />
            {query.trim() && (
              <ul className="mt-2 divide-y divide-neutral-100">
                {candidates.length === 0 && <li className="py-2 text-sm text-neutral-500">Không tìm thấy (hoặc đã có trong danh sách).</li>}
                {candidates.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 text-sm">
                      {c.name} <span className="text-neutral-400">· {c.baseUnit}</span>
                    </span>
                    <button
                      type="button"
                      className="btn-secondary shrink-0 px-3 py-1.5 text-sm"
                      disabled={pending}
                      onClick={() => run(() => addHandoverItem(branchId, c.id, c.baseUnit))}
                    >
                      + Thêm
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!query.trim() && (
              <div className="mt-3 flex flex-wrap gap-2">
                {catalog
                  .filter((c) => !used.has(c.id))
                  .slice(0, 30)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => addHandoverItem(branchId, c.id, c.baseUnit))}
                      className="rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-left text-sm hover:border-neutral-400"
                    >
                      + {c.name}
                    </button>
                  ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
