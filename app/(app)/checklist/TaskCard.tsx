"use client";

import { startTransition, useState } from "react";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { resizeImage } from "@/components/image-resize";
import { completeTask } from "./actions";
import { CATEGORY_ICONS, DISPLAY_STATUS, PRIORITY_LABELS, type DisplayStatus } from "@/lib/checklist";
import { formatTime } from "@/lib/time";
import type { TaskPriority } from "@/lib/database.types";

export type TaskCardData = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: TaskPriority;
  startAt: string;
  dueAt: string;
  requiresPhoto: boolean;
  requiresNote: boolean;
  displayStatus: DisplayStatus;
  completedByName: string | null;
  completedAt: string | null;
  note: string | null;
  photoUrl: string | null;
  reopenReason: string | null;
  /** Vai trò của người đang xem với việc này */
  role: "primary" | "backup" | "shift";
  primaryName: string;
  /** null = được phép đánh dấu; chuỗi = lý do không được */
  blockedReason: string | null;
};

type Mode = "done" | "failed" | null;

export default function TaskCard({ task, onDone }: { task: TaskCardData; onDone: (message: string) => void }) {
  const [mode, setMode] = useState<Mode>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const close = () => {
    setMode(null);
    setPreview(null);
  };

  const after = (message: string) => {
    close();
    onDone(message);
  };
  const [doneState, doneAction, donePending] = useFormAction(completeTask.bind(null, task.id, "done"), (r) => after(r.message));
  const [failState, failAction, failPending] = useFormAction(completeTask.bind(null, task.id, "failed"), (r) => after(r.message));
  const state = mode === "failed" ? failState : doneState;
  const pending = mode === "failed" ? failPending : donePending;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const photo = formData.get("photo");
    if (photo instanceof File && photo.size > 0) {
      setPreparing(true);
      formData.set("photo", await resizeImage(photo));
      setPreparing(false);
    }
    startTransition(() => (mode === "failed" ? failAction : doneAction)(formData));
  }

  const status = DISPLAY_STATUS[task.displayStatus];
  const priority = PRIORITY_LABELS[task.priority];
  const isPending = ["upcoming", "open", "overdue"].includes(task.displayStatus);

  return (
    <li className={`card p-4 ${task.displayStatus === "overdue" ? "border-red-200" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            <span aria-hidden="true">{CATEGORY_ICONS[task.category] ?? "📌"} </span>
            {task.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-medium ${status.className}`}>{status.label}</span>
            {task.priority !== "normal" && (
              <span className={`rounded-full px-2 py-0.5 font-medium ${priority.className}`}>{priority.label}</span>
            )}
            <span className="tabular-nums text-neutral-500">
              {formatTime(task.startAt)} – {formatTime(task.dueAt)}
            </span>
            {task.requiresPhoto && <span className="text-neutral-500">📷 Cần ảnh</span>}
            {task.requiresNote && <span className="text-neutral-500">📝 Cần ghi chú</span>}
          </div>
          {task.role === "shift" && <p className="mt-1 text-xs text-violet-700">🕒 Việc của ca — ai trong ca làm cũng được</p>}
          {task.role === "backup" && (
            <p className="mt-1 text-xs text-violet-700">Làm thay cho {task.primaryName}</p>
          )}
          {task.description && <p className="mt-2 text-sm text-neutral-600">{task.description}</p>}
          {task.reopenReason && isPending && (
            <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Quản lý yêu cầu làm lại: {task.reopenReason}
            </p>
          )}
        </div>
      </div>

      {!isPending && task.completedAt && (
        <div className="mt-3 flex items-start gap-3 rounded-lg bg-neutral-50 p-3 text-sm">
          {task.photoUrl && (
            <a href={task.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={task.photoUrl} alt="Ảnh hoàn thành" className="h-16 w-16 rounded-md object-cover" />
            </a>
          )}
          <div className="min-w-0 text-neutral-600">
            <p>
              {task.completedByName} · {formatTime(task.completedAt)}
            </p>
            {task.note && <p className="mt-0.5 text-neutral-800">{task.note}</p>}
          </div>
        </div>
      )}

      {isPending &&
        (task.blockedReason ? (
          <p className="mt-3 text-xs text-neutral-500">{task.blockedReason}</p>
        ) : (
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setMode("done")} className="btn flex-1 bg-emerald-600 text-white hover:bg-emerald-700">
              ✓ Hoàn thành
            </button>
            <button type="button" onClick={() => setMode("failed")} className="btn-secondary">
              Không đạt
            </button>
          </div>
        ))}

      <Dialog
        open={mode !== null}
        onClose={close}
        title={mode === "failed" ? "Báo không đạt" : "Hoàn thành công việc"}
        description={task.title}
      >
        <form onSubmit={submit} className="space-y-4">
          {mode === "done" && (
            <div>
              <label htmlFor={`photo-${task.id}`} className="mb-1.5 block text-sm font-medium text-neutral-700">
                Ảnh {task.requiresPhoto ? <span className="text-red-600">* (bắt buộc)</span> : "(tùy chọn)"}
              </label>
              <input
                id={`photo-${task.id}`}
                name="photo"
                type="file"
                accept="image/*"
                capture="environment"
                required={task.requiresPhoto}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setPreview(file ? URL.createObjectURL(file) : null);
                }}
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-brand-fg"
              />
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Xem trước" className="mt-3 max-h-56 rounded-lg object-contain" />
              )}
              {state.fieldErrors?.photo && <p className="field-error">{state.fieldErrors.photo}</p>}
            </div>
          )}

          <div>
            <label htmlFor={`note-${task.id}`} className="mb-1.5 block text-sm font-medium text-neutral-700">
              {mode === "failed" ? (
                <>Lý do không hoàn thành <span className="text-red-600">*</span></>
              ) : task.requiresNote ? (
                <>Ghi chú <span className="text-red-600">*</span></>
              ) : (
                "Ghi chú (tùy chọn)"
              )}
            </label>
            <textarea
              id={`note-${task.id}`}
              name="note"
              rows={3}
              maxLength={1000}
              required={mode === "failed" || task.requiresNote}
              placeholder={mode === "failed" ? "Ví dụ: Hết nước rửa chén, đã báo quản lý." : ""}
              className="input"
            />
            {state.fieldErrors?.note && <p className="field-error">{state.fieldErrors.note}</p>}
          </div>

          {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}

          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={close} className="btn-secondary">Hủy</button>
            <SubmitButton
              pending={pending || preparing}
              pendingText={preparing ? "Đang xử lý ảnh..." : "Đang lưu..."}
              variant={mode === "failed" ? "danger" : "primary"}
            >
              {mode === "failed" ? "Báo không đạt" : "Xác nhận hoàn thành"}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </li>
  );
}
