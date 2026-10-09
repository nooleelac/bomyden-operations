"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatQty, ISSUE_KIND_HINTS, ISSUE_KIND_LABELS, matchesSearch, parseVnNumber } from "@/lib/inventory";
import type { BranchRef } from "@/lib/branches";
import type { CatalogItem } from "../../receive/types";
import { createStockIssue } from "../../stock-actions";

type Kind = keyof typeof ISSUE_KIND_LABELS;
type Line = { key: number; itemId: string; qty: string; unit: string };

export default function IssueForm({
  branchId,
  catalog,
  stock,
  otherBranches,
}: {
  branchId: string;
  catalog: CatalogItem[];
  stock: Record<string, number>;
  otherBranches: BranchRef[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("waste");
  const [toBranchId, setToBranchId] = useState(otherBranches[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const items = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);

  const suggestions = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const chosen = new Set(lines.map((l) => l.itemId));
    return catalog.filter((c) => !chosen.has(c.id) && matchesSearch(c.name, q)).slice(0, 8);
  }, [catalog, query, lines]);

  const addItem = (item: CatalogItem) => {
    setLines((prev) => [...prev, { key: Date.now(), itemId: item.id, qty: "", unit: item.baseUnit }]);
    setQuery("");
  };
  const patchLine = (key: number, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const kinds = (Object.keys(ISSUE_KIND_LABELS) as Kind[]).filter((k) => k !== "transfer" || otherBranches.length > 0);

  const submit = () => {
    setError("");
    const payloadLines: { itemId: string; quantity: number; unitName: string }[] = [];
    for (const line of lines) {
      const item = items.get(line.itemId)!;
      const qty = parseVnNumber(line.qty);
      if (qty === null || qty <= 0) {
        setError(`"${item.name}": nhập số lượng lớn hơn 0.`);
        return;
      }
      payloadLines.push({ itemId: line.itemId, quantity: qty, unitName: line.unit });
    }
    if (payloadLines.length === 0) return setError("Thêm ít nhất 1 nguyên liệu.");
    if (reason.trim().length < 3) return setError("Ghi lý do xuất kho (ít nhất 3 ký tự).");
    if (kind === "transfer" && !toBranchId) return setError("Chọn chi nhánh nhận hàng.");

    startTransition(async () => {
      const result = await createStockIssue({
        branchId,
        kind,
        toBranchId: kind === "transfer" ? toBranchId : null,
        reason,
        lines: payloadLines,
      });
      if (!result.ok) return setError(result.message);
      router.push(`/inventory/issues/${result.id}`);
    });
  };

  return (
    <div className="space-y-4">
      <fieldset className="card p-4">
        <legend className="sr-only">Loại phiếu xuất</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {kinds.map((k) => (
            <label
              key={k}
              className={`cursor-pointer rounded-xl border p-3 text-sm transition ${kind === k ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 hover:border-neutral-400"}`}
            >
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              <span className="block font-semibold">{ISSUE_KIND_LABELS[k]}</span>
              <span className={`mt-0.5 block text-xs ${kind === k ? "text-neutral-300" : "text-neutral-500"}`}>{ISSUE_KIND_HINTS[k]}</span>
            </label>
          ))}
        </div>

        {kind === "transfer" && (
          <div className="mt-4">
            <label htmlFor="to-branch" className="mb-1.5 block text-sm font-medium text-neutral-700">Chuyển đến chi nhánh</label>
            <select id="to-branch" className="input" value={toBranchId} onChange={(e) => setToBranchId(e.target.value)}>
              {otherBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="issue-reason" className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do</label>
          <input
            id="issue-reason"
            className="input"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={kind === "waste" ? "vd: Thịt bò để quá hạn, rau bị dập" : kind === "transfer" ? "vd: Chi nhánh 2 thiếu hàng" : "vd: Trả lại nhà cung cấp"}
          />
        </div>
      </fieldset>

      <section className="card overflow-hidden">
        <div className="relative border-b border-neutral-100 p-4">
          <label htmlFor="issue-search" className="mb-1.5 block text-sm font-medium text-neutral-700">Thêm nguyên liệu</label>
          <input
            id="issue-search"
            type="search"
            className="input"
            placeholder="Gõ tên nguyên liệu..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {suggestions.length > 0 && (
            <ul className="absolute inset-x-4 z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
              {suggestions.map((s) => (
                <li key={s.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-50" onClick={() => addItem(s)}>
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-neutral-500">Tồn {formatQty(stock[s.id] ?? 0)} {s.baseUnit}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-neutral-500">Chưa có nguyên liệu nào.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {lines.map((line) => {
              const item = items.get(line.itemId)!;
              const factor = line.unit === item.baseUnit ? 1 : item.units.find((u) => u.name === line.unit)?.factor ?? 1;
              const qty = parseVnNumber(line.qty);
              const over = qty !== null && qty * factor > (stock[item.id] ?? 0);
              return (
                <li key={line.key} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium">{item.name}</p>
                    <p className={`text-xs ${over ? "text-amber-700" : "text-neutral-500"}`}>
                      Tồn {formatQty(stock[item.id] ?? 0)} {item.baseUnit}
                      {over && " · vượt tồn trên sổ"}
                    </p>
                  </div>
                  <input
                    className="input w-20 shrink-0 text-right tabular-nums"
                    inputMode="decimal"
                    value={line.qty}
                    onChange={(e) => patchLine(line.key, { qty: e.target.value })}
                    aria-label={`Số lượng ${item.name}`}
                    autoFocus
                  />
                  {item.units.length > 0 ? (
                    <select className="input w-20 shrink-0 px-2" value={line.unit} onChange={(e) => patchLine(line.key, { unit: e.target.value })} aria-label="Đơn vị">
                      <option value={item.baseUnit}>{item.baseUnit}</option>
                      {item.units.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                    </select>
                  ) : (
                    <span className="w-20 shrink-0 text-sm text-neutral-500">{item.baseUnit}</span>
                  )}
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
                    onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                    aria-label={`Bỏ ${item.name}`}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {error && <p className="alert-error">{error}</p>}
      <div className="flex justify-end">
        <button type="button" className="btn-primary" onClick={submit} disabled={pending || lines.length === 0}>
          {pending ? "Đang lưu..." : "Lưu phiếu xuất"}
        </button>
      </div>
    </div>
  );
}
