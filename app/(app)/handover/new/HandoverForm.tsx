"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resizeImage } from "@/components/image-resize";
import { isNetworkError, OFFLINE_MESSAGE } from "@/lib/action-state";
import { formatQty, parseVnNumber } from "@/lib/inventory";
import { formatDateTime } from "@/lib/time";
import { createHandover, uploadHandoverPhoto } from "../actions";

export type HandoverFormItem = {
  /** id dòng trong danh sách món bàn giao */
  id: string;
  name: string;
  unit: string;
  requiresPhoto: boolean;
  /** Số lượng ở phiếu bàn giao trước (cùng đơn vị) */
  previousQty: number | null;
};

type Photo = { path: string | null; preview: string | null; uploading: boolean; error: string };
type Entry = { qty: string; photo: Photo | null };

const draftKey = (branchId: string) => `bomyden-handover-draft-${branchId}`;

/** Nháp: chỉ lưu số lượng + đường dẫn ảnh đã tải xong (ảnh xem trước không lưu được). */
function readDraft(branchId: string): { entries: Record<string, Entry>; note: string } {
  try {
    const raw = localStorage.getItem(draftKey(branchId));
    if (raw) {
      const draft = JSON.parse(raw) as { entries: Record<string, { qty: string; path: string | null }>; note: string };
      const entries: Record<string, Entry> = {};
      for (const [id, e] of Object.entries(draft.entries ?? {})) {
        entries[id] = { qty: e.qty ?? "", photo: e.path ? { path: e.path, preview: null, uploading: false, error: "" } : null };
      }
      return { entries, note: draft.note ?? "" };
    }
  } catch {}
  return { entries: {}, note: "" };
}

function writeDraft(branchId: string, entries: Record<string, Entry>, note: string) {
  try {
    const slim = Object.fromEntries(
      Object.entries(entries)
        .map(([id, e]) => [id, { qty: e.qty, path: e.photo?.path ?? null }] as const)
        .filter(([, e]) => e.qty || e.path)
    );
    if (Object.keys(slim).length === 0 && !note) localStorage.removeItem(draftKey(branchId));
    else localStorage.setItem(draftKey(branchId), JSON.stringify({ entries: slim, note }));
  } catch {}
}

export default function HandoverForm({
  branchId,
  branchName,
  items,
  previousAt,
}: {
  branchId: string;
  branchName: string;
  items: HandoverFormItem[];
  previousAt: string | null;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // Bản mới nhất để các lần tải ảnh chạy song song không ghi đè lẫn nhau
  const entriesRef = useRef(entries);
  const noteRef = useRef(note);

  useEffect(() => {
    const draft = readDraft(branchId);
    entriesRef.current = draft.entries;
    noteRef.current = draft.note;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đồng bộ một lần từ localStorage
    setEntries(draft.entries);
    setNote(draft.note);
  }, [branchId]);

  const patch = (itemId: string, change: (e: Entry) => Entry) => {
    const current = entriesRef.current[itemId] ?? { qty: "", photo: null };
    const next = { ...entriesRef.current, [itemId]: change(current) };
    entriesRef.current = next;
    setEntries(next);
    setError("");
    writeDraft(branchId, next, noteRef.current);
  };

  async function pickPhoto(item: HandoverFormItem, file: File | undefined) {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    patch(item.id, (e) => ({ ...e, photo: { path: null, preview, uploading: true, error: "" } }));
    let result: { ok: boolean; message: string; path?: string };
    try {
      const formData = new FormData();
      formData.set("photo", await resizeImage(file));
      result = await uploadHandoverPhoto(branchId, formData);
    } catch (e) {
      result = { ok: false, message: isNetworkError(e) ? "Mất mạng — chụp lại khi có mạng." : "Không tải được ảnh." };
    }
    patch(item.id, (e) =>
      e.photo?.preview !== preview
        ? e // đã chụp ảnh khác trong lúc chờ
        : { ...e, photo: { path: result.path ?? null, preview, uploading: false, error: result.ok ? "" : result.message } }
    );
  }

  const done = items.filter((item) => {
    const e = entries[item.id];
    return e && e.qty.trim() !== "" && (!item.requiresPhoto || e.photo?.path);
  }).length;
  const uploading = Object.values(entries).some((e) => e.photo?.uploading);

  const submit = () => {
    setError("");
    const lines: { handoverItemId: string; quantity: number; photoPath: string | null }[] = [];
    for (const item of items) {
      const e = entries[item.id];
      const qty = e ? parseVnNumber(e.qty) : null;
      if (qty === null || qty < 0) {
        setError(`Chưa nhập số lượng "${item.name}".`);
        document.getElementById(`q-${item.id}`)?.focus();
        return;
      }
      if (item.requiresPhoto && !e?.photo?.path) {
        setError(`Chưa chụp ảnh "${item.name}".`);
        return;
      }
      lines.push({ handoverItemId: item.id, quantity: Math.round(qty * 10000) / 10000, photoPath: e?.photo?.path ?? null });
    }
    if (!confirm(`Gửi phiếu bàn giao ${lines.length} món tại ${branchName}?`)) return;
    startTransition(async () => {
      try {
        const result = await createHandover({ branchId, note, lines });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        writeDraft(branchId, {}, "");
        router.push(`/handover/${result.id}`);
      } catch (e) {
        if (isNetworkError(e)) setError(OFFLINE_MESSAGE);
        else throw e;
      }
    });
  };

  return (
    <div className="pb-24">
      {previousAt && <p className="mb-3 text-xs text-neutral-500">Số &quot;lần trước&quot; lấy từ phiếu bàn giao lúc {formatDateTime(previousAt)}.</p>}

      <ul className="space-y-3">
        {items.map((item) => {
          const e = entries[item.id];
          const qty = e ? parseVnNumber(e.qty) : null;
          const photo = e?.photo ?? null;
          const ok = e && e.qty.trim() !== "" && qty !== null && (!item.requiresPhoto || photo?.path);
          return (
            <li key={item.id} className={`card p-4 ${ok ? "border-emerald-200 bg-emerald-50/40" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <label htmlFor={`q-${item.id}`} className="min-w-0">
                  <span className="line-clamp-2 block font-medium">{item.name}</span>
                  {item.previousQty !== null && (
                    <span className="block text-xs text-neutral-500">
                      Lần trước: {formatQty(item.previousQty)} {item.unit}
                    </span>
                  )}
                </label>
                {ok && <span className="shrink-0 text-emerald-600" aria-label="Đã xong">✓</span>}
              </div>

              <div className="mt-3 flex items-center gap-3">
                <div className="flex shrink-0 items-center gap-2">
                  <input
                    id={`q-${item.id}`}
                    className="input w-28 text-right text-lg tabular-nums"
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Số lượng ${item.name}`}
                    value={e?.qty ?? ""}
                    onChange={(ev) => patch(item.id, (x) => ({ ...x, qty: ev.target.value }))}
                  />
                  <span className="text-sm text-neutral-600">{item.unit}</span>
                </div>

                <label
                  className={`ml-auto flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                    photo?.path ? "border-neutral-300 bg-white text-neutral-700" : "border-brand bg-brand text-brand-fg"
                  }`}
                >
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(ev) => {
                      pickPhoto(item, ev.target.files?.[0]);
                      ev.target.value = "";
                    }}
                  />
                  📷 {photo?.path || photo?.uploading ? "Chụp lại" : item.requiresPhoto ? "Chụp ảnh *" : "Chụp ảnh"}
                </label>
              </div>

              {photo && (
                <div className="mt-3 flex items-center gap-3 text-sm">
                  {photo.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.preview} alt={`Ảnh ${item.name}`} className="h-20 w-20 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-20 w-20 items-center justify-center rounded-md bg-neutral-100 text-2xl" aria-hidden="true">🖼️</span>
                  )}
                  <span className={photo.error ? "text-red-600" : photo.uploading ? "text-neutral-500" : "text-emerald-700"}>
                    {photo.error || (photo.uploading ? "Đang tải ảnh lên..." : "Đã lưu ảnh")}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4">
        <label htmlFor="handover-note" className="mb-1.5 block text-sm font-medium text-neutral-700">Ghi chú (tùy chọn)</label>
        <textarea
          id="handover-note"
          className="input"
          rows={2}
          maxLength={1000}
          placeholder="vd: Đã rã đông 2kg cho ca tối, tủ đông 2 hơi yếu"
          value={note}
          onChange={(ev) => {
            setNote(ev.target.value);
            noteRef.current = ev.target.value;
            writeDraft(branchId, entriesRef.current, ev.target.value);
          }}
        />
      </div>

      <div className="fixed inset-x-0 bottom-(--nav-h) z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <p className="font-medium">
              Xong {done}/{items.length} món
            </p>
            {error ? <p className="truncate text-red-600">{error}</p> : <p className="text-xs text-neutral-500">Nháp được tự lưu trên máy này</p>}
          </div>
          <button type="button" className="btn-primary shrink-0" onClick={submit} disabled={pending || uploading}>
            {pending ? "Đang gửi..." : uploading ? "Đang tải ảnh..." : "Gửi bàn giao"}
          </button>
        </div>
      </div>
    </div>
  );
}
