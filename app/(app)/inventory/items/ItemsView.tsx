"use client";

import { startTransition, useMemo, useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { ITEM_CATEGORIES, formatMoney, formatQty, normName } from "@/lib/inventory";
import { deleteAlias, saveItem } from "../actions";

export type ItemRow = {
  id: string;
  name: string;
  category: string;
  baseUnit: string;
  isActive: boolean;
  units: { name: string; factor: number }[];
  aliases: { id: string; text: string; unit: string; factor: number; supplier: string | null }[];
  history: { date: string; supplier: string | null; perBase: number; quantity: number; unit: string }[];
};

export default function ItemsView({ rows }: { rows: ItemRow[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ItemRow | "new" | null>(null);
  const [message, setMessage] = useState("");

  const filtered = useMemo(() => {
    const q = normName(query);
    return q ? rows.filter((r) => normName(r.name).includes(q) || r.aliases.some((a) => a.text.includes(q))) : rows;
  }, [rows, query]);

  return (
    <div>
      {message && <p className="alert-success mb-4">{message}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" className="input max-w-xs" placeholder="Tìm nguyên liệu..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Tìm nguyên liệu" />
        <button type="button" className="btn-primary" onClick={() => setEditing("new")}>+ Thêm nguyên liệu</button>
      </div>

      {filtered.length === 0 ? (
        <p className="card p-8 text-center text-neutral-500">Chưa có nguyên liệu. Nguyên liệu cũng được tạo tự động khi lưu phiếu nhập.</p>
      ) : (
        <ul className="card divide-y divide-neutral-100">
          {filtered.map((row) => (
            <li key={row.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50" onClick={() => setEditing(row)}>
                <div className="min-w-0">
                  <p className={`truncate font-medium ${row.isActive ? "" : "text-neutral-400 line-through"}`}>{row.name}</p>
                  <p className="text-xs text-neutral-500">
                    {row.category} · đơn vị kho: {row.baseUnit}
                    {row.units.length > 0 && ` · ${row.units.map((u) => `1 ${u.name} = ${formatQty(u.factor)} ${row.baseUnit}`).join(", ")}`}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-neutral-500">
                  {row.history[0] && <p className="font-medium text-neutral-800">{formatMoney(row.history[0].perBase)}/{row.baseUnit}</p>}
                  {row.aliases.length > 0 && <p>{row.aliases.length} tên đã nhớ</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ItemDialog
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(m) => {
            setEditing(null);
            setMessage(m);
          }}
        />
      )}
    </div>
  );
}

function ItemDialog({ item, onClose, onDone }: { item: ItemRow | null; onClose: () => void; onDone: (m: string) => void }) {
  const [state, action, pending] = useFormAction(saveItem.bind(null, item?.id ?? null), (r) => onDone(r.message));
  const [units, setUnits] = useState(item?.units.length ? item.units.map((u) => ({ ...u, factor: String(u.factor) })) : []);
  const [baseUnit, setBaseUnit] = useState(item?.baseUnit ?? "");
  const [aliases, setAliases] = useState(item?.aliases ?? []);
  const categories = item && !ITEM_CATEGORIES.includes(item.category) ? [...ITEM_CATEGORIES, item.category] : ITEM_CATEGORIES;

  return (
    <Dialog open onClose={onClose} title={item ? "Sửa nguyên liệu" : "Thêm nguyên liệu"}>
      <ActionForm action={action} className="space-y-4">
        <div>
          <label htmlFor="item-name" className="mb-1.5 block text-sm font-medium text-neutral-700">Tên nguyên liệu</label>
          <input id="item-name" name="name" className="input" defaultValue={item?.name} required maxLength={150} />
          {state.fieldErrors?.name && <p className="field-error">{state.fieldErrors.name}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="item-category" className="mb-1.5 block text-sm font-medium text-neutral-700">Nhóm</label>
            <select id="item-category" name="category" className="input" defaultValue={item?.category ?? "Khác"}>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="item-unit" className="mb-1.5 block text-sm font-medium text-neutral-700">Đơn vị kho</label>
            <input id="item-unit" name="base_unit" className="input" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} required maxLength={20} placeholder="kg, chai, gói…" />
            {state.fieldErrors?.base_unit && <p className="field-error">{state.fieldErrors.base_unit}</p>}
          </div>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-neutral-700">Đơn vị quy đổi</legend>
          <div className="space-y-2">
            {units.map((unit, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span>1</span>
                <input
                  name="unit_name"
                  className="input w-28"
                  value={unit.name}
                  maxLength={20}
                  placeholder="thùng"
                  onChange={(e) => setUnits((u) => u.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  aria-label="Tên đơn vị"
                />
                <span>=</span>
                <input
                  name="unit_factor"
                  className="input w-24"
                  inputMode="decimal"
                  value={unit.factor}
                  onChange={(e) => setUnits((u) => u.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))}
                  aria-label="Hệ số"
                />
                <span className="text-neutral-500">{baseUnit || "đv kho"}</span>
                <button type="button" className="ml-auto rounded p-1 text-neutral-400 hover:text-red-600" onClick={() => setUnits((u) => u.filter((_, j) => j !== i))} aria-label="Xóa đơn vị">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="text-sm font-medium text-neutral-700 underline" onClick={() => setUnits((u) => [...u, { name: "", factor: "" }])}>
              + Thêm đơn vị (thùng, hộp, bao…)
            </button>
          </div>
          {state.fieldErrors?.units && <p className="field-error">{state.fieldErrors.units}</p>}
        </fieldset>

        {item && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={item.isActive} className="h-4 w-4" />
            Đang dùng (bỏ chọn để ẩn khỏi danh sách khi nhập kho)
          </label>
        )}

        {state.message && !state.ok && !state.fieldErrors && <p className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Hủy</button>
          <SubmitButton pending={pending}>Lưu</SubmitButton>
        </div>
      </ActionForm>

      {item && aliases.length > 0 && (
        <section className="mt-6 border-t border-neutral-100 pt-4">
          <h3 className="text-sm font-semibold">Tên trên hóa đơn app đã nhớ</h3>
          <p className="mb-2 text-xs text-neutral-500">Lần sau gặp các tên này, app tự chọn nguyên liệu này. Xóa nếu app nhớ sai.</p>
          <ul className="space-y-1 text-sm">
            {aliases.map((alias) => (
              <AliasRow key={alias.id} alias={alias} baseUnit={item.baseUnit} onDeleted={() => setAliases((a) => a.filter((x) => x.id !== alias.id))} />
            ))}
          </ul>
        </section>
      )}

      {item && item.history.length > 0 && (
        <section className="mt-6 border-t border-neutral-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold">Lịch sử giá nhập</h3>
          <ul className="space-y-1 text-sm">
            {item.history.map((h, i) => {
              const [y, m, d] = h.date.split("-");
              return (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-neutral-500">
                    {d}/{m}/{y.slice(2)} · {h.supplier ?? "—"} · {formatQty(h.quantity)} {h.unit}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{formatMoney(h.perBase)}/{item.baseUnit}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Dialog>
  );
}

function AliasRow({ alias, baseUnit, onDeleted }: { alias: ItemRow["aliases"][number]; baseUnit: string; onDeleted: () => void }) {
  const [pending, setPending] = useState(false);
  return (
    <li className="flex items-center justify-between gap-2 rounded-md bg-neutral-50 px-2 py-1">
      <span className="min-w-0 truncate">
        &ldquo;{alias.text}&rdquo; <span className="text-neutral-400">({alias.unit}{alias.factor !== 1 ? ` = ${formatQty(alias.factor)} ${baseUnit}` : ""}{alias.supplier ? ` · ${alias.supplier}` : ""})</span>
      </span>
      <button
        type="button"
        disabled={pending}
        className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
        onClick={() => {
          setPending(true);
          startTransition(async () => {
            const result = await deleteAlias(alias.id);
            setPending(false);
            if (result.ok) onDeleted();
          });
        }}
      >
        Xóa
      </button>
    </li>
  );
}
