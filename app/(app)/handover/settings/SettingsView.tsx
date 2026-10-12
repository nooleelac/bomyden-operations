"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addHandoverItem, moveHandoverItem, removeHandoverItem, updateHandoverItem, type SaveResult } from "../actions";

type Row = { id: string; name: string; unit: string; requiresPhoto: boolean };

/** Danh sách món bàn giao (QTV / QL chi nhánh): thêm, sửa tên & đơn vị, sắp xếp, bật tắt ảnh, gỡ món. */
export default function SettingsView({ branchId, rows }: { branchId: string; rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState({ name: "", unit: "" });
  const [editing, setEditing] = useState<{ id: string; name: string; unit: string } | null>(null);

  const run = (action: () => Promise<SaveResult>, onOk?: () => void) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.message ? { ok: result.ok, text: result.message } : null);
      if (result.ok) {
        onOk?.();
        router.refresh();
      }
    });

  return (
    <div className="space-y-5">
      {message && <p role="status" className={message.ok ? "alert-success" : "alert-error"}>{message.text}</p>}

      <section className="card overflow-hidden">
        <h2 className="border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-600">
          Đang bàn giao ({rows.length} món)
        </h2>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-500">
            Chưa có món nào — thêm ở bên dưới.
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((row, index) =>
              editing?.id === row.id ? (
                <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <input
                    className="input min-w-0 flex-1 basis-48"
                    aria-label="Tên món"
                    maxLength={150}
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                  <input
                    className="input w-24"
                    aria-label="Đơn vị"
                    maxLength={20}
                    value={editing.unit}
                    onChange={(e) => setEditing({ ...editing, unit: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn-primary px-3 py-1.5 text-sm"
                    disabled={pending || !editing.name.trim() || !editing.unit.trim()}
                    onClick={() => run(() => updateHandoverItem(row.id, { name: editing.name, unit: editing.unit }), () => setEditing(null))}
                  >
                    Lưu
                  </button>
                  <button type="button" className="text-sm text-neutral-500 hover:underline" onClick={() => setEditing(null)}>
                    Hủy
                  </button>
                </li>
              ) : (
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
                  <p className="min-w-0 flex-1 text-sm font-medium">{row.name}</p>
                  <span className="text-sm text-neutral-500">{row.unit}</span>
                  <button
                    type="button"
                    className="text-sm text-neutral-600 hover:underline disabled:opacity-50"
                    disabled={pending}
                    onClick={() => setEditing({ id: row.id, name: row.name, unit: row.unit })}
                  >
                    Sửa
                  </button>
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
                    onClick={() => confirm(`Bỏ "${row.name}" khỏi danh sách bàn giao?`) && run(() => removeHandoverItem(row.id))}
                  >
                    Bỏ
                  </button>
                </li>
              )
            )}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold text-neutral-700">Thêm món</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Gõ tên món như muốn nhân viên thấy (vd: Thịt bò thăn, Sốt tiêu đen pha sẵn) — không liên kết với danh mục Kho.
        </p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addHandoverItem(branchId, draft), () => setDraft({ name: "", unit: "" }));
          }}
        >
          <input
            className="input min-w-0 flex-1 basis-48"
            placeholder="Tên món"
            aria-label="Tên món mới"
            maxLength={150}
            required
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="input w-28"
            placeholder="Đơn vị (kg, hũ…)"
            aria-label="Đơn vị món mới"
            maxLength={20}
            required
            value={draft.unit}
            onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
          />
          <button type="submit" className="btn-primary" disabled={pending}>
            + Thêm
          </button>
        </form>
      </section>
    </div>
  );
}
