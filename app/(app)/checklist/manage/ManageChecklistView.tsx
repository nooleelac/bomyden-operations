"use client";

import { useCallback, useEffect, useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import TemplateDialog, { type BranchStaff, type TemplateItem } from "./TemplateDialog";
import { reopenTask } from "./actions";
import { CATEGORY_ICONS, DISPLAY_STATUS, PRIORITY_LABELS, describeSchedule, type DisplayStatus } from "@/lib/checklist";
import { formatTime } from "@/lib/time";

export type ReportItem = {
  id: string;
  title: string;
  category: string;
  branchName: string;
  startAt: string;
  dueAt: string;
  displayStatus: DisplayStatus;
  primaryName: string;
  backupName: string | null;
  completedByName: string | null;
  completedAt: string | null;
  note: string | null;
  photoUrl: string | null;
  canReopen: boolean;
};

type Props = {
  tab: "report" | "templates";
  report: ReportItem[];
  templates: TemplateItem[];
  branches: BranchStaff[];
  dateLabel: string;
};

function ReopenButton({ id, title, onDone }: { id: string; title: string; onDone: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(reopenTask.bind(null, id), (r) => {
    setOpen(false);
    onDone(r.message);
  });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-neutral-500 hover:text-neutral-900 hover:underline">
        Yêu cầu làm lại
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Yêu cầu làm lại" description={title}>
        <ActionForm action={action} className="space-y-4">
          <div>
            <label htmlFor={`ro-${id}`} className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do</label>
            <textarea id={`ro-${id}`} name="reason" rows={3} required maxLength={500} placeholder="Ví dụ: Ảnh mờ, chụp lại giúp anh." className="input" />
            {state.fieldErrors?.reason && <p className="field-error">{state.fieldErrors.reason}</p>}
          </div>
          {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Hủy</button>
            <SubmitButton pending={pending}>Mở lại</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}

const ORDER: DisplayStatus[] = ["overdue", "failed", "open", "upcoming", "late", "done"];

export default function ManageChecklistView({ tab, report, templates, branches, dateLabel }: Props) {
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<TemplateItem | "new" | null>(null);
  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const counts = Object.fromEntries(ORDER.map((s) => [s, report.filter((r) => r.displayStatus === s).length])) as Record<DisplayStatus, number>;
  const sorted = [...report].sort(
    (a, b) => ORDER.indexOf(a.displayStatus) - ORDER.indexOf(b.displayStatus) || a.dueAt.localeCompare(b.dueAt)
  );

  return (
    <>
      {tab === "report" ? (
        <section>
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ORDER.map((s) => (
              <div key={s} className={`rounded-xl px-3 py-2 text-center ${DISPLAY_STATUS[s].className}`}>
                <p className="text-xl font-bold">{counts[s]}</p>
                <p className="text-xs">{DISPLAY_STATUS[s].label}</p>
              </div>
            ))}
          </div>

          {sorted.length === 0 ? (
            <div className="card px-6 py-10 text-center text-sm text-neutral-500">Không có công việc nào {dateLabel}.</div>
          ) : (
            <ul className="card divide-y divide-neutral-100">
              {sorted.map((item) => {
                const status = DISPLAY_STATUS[item.displayStatus];
                return (
                  <li key={item.id} className="flex gap-3 p-4">
                    {item.photoUrl && (
                      <a href={item.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.photoUrl} alt="Ảnh hoàn thành" className="h-14 w-14 rounded-md object-cover" />
                      </a>
                    )}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{CATEGORY_ICONS[item.category] ?? "📌"} {item.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-0.5 text-neutral-500">
                        {item.branchName} · {formatTime(item.startAt)}–{formatTime(item.dueAt)} · {item.primaryName}
                        {item.backupName && <span> (thay: {item.backupName})</span>}
                      </p>
                      {item.completedAt && (
                        <p className="mt-0.5 text-neutral-700">
                          {item.completedByName} · {formatTime(item.completedAt)}
                          {item.note && <span className="text-neutral-500"> — {item.note}</span>}
                        </p>
                      )}
                      {item.canReopen && (
                        <div className="mt-1">
                          <ReopenButton id={item.id} title={item.title} onDone={notify} />
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <section>
          <div className="mb-3 flex justify-end">
            <button type="button" onClick={() => setEditing("new")} className="btn-primary" disabled={branches.length === 0}>
              + Tạo công việc
            </button>
          </div>
          {templates.length === 0 ? (
            <div className="card px-6 py-10 text-center text-sm text-neutral-500">Chưa có mẫu công việc nào.</div>
          ) : (
            <ul className="space-y-3">
              {templates.map((t) => (
                <li key={t.id} className={`card p-4 ${t.isActive ? "" : "opacity-60"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{CATEGORY_ICONS[t.category] ?? "📌"} {t.title}</span>
                        {t.priority !== "normal" && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_LABELS[t.priority].className}`}>
                            {PRIORITY_LABELS[t.priority].label}
                          </span>
                        )}
                        {!t.isActive && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">Tạm ngưng</span>}
                      </div>
                      <p className="mt-1 text-neutral-500">
                        {t.branchName} · {t.startTime}–{t.dueTime} · {describeSchedule(t.frequency, t.weekdays, t.monthDays)}
                      </p>
                      <p className="mt-0.5 text-neutral-700">
                        👤 {t.primaryName}
                        {t.backupName && <span className="text-neutral-500"> · thay: {t.backupName}</span>}
                        {t.requiresPhoto && <span className="text-neutral-500"> · 📷</span>}
                        {t.requiresNote && <span className="text-neutral-500"> · 📝</span>}
                      </p>
                    </div>
                    <button type="button" onClick={() => setEditing(t)} className="btn-secondary shrink-0 px-3 py-1.5">Sửa</button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <TemplateDialog
            key={editing === "new" ? "new" : editing?.id ?? "none"}
            template={editing && editing !== "new" ? editing : undefined}
            branches={branches}
            open={editing !== null}
            onClose={() => setEditing(null)}
            onDone={(message) => {
              setEditing(null);
              notify(message);
            }}
          />
        </section>
      )}

      {toast && (
        <p role="status" className="alert-success fixed inset-x-4 bottom-4 z-50 shadow-lg sm:left-auto sm:right-6 sm:w-96">
          {toast}
        </p>
      )}
    </>
  );
}
