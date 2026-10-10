"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import TemplateDialog, { type BranchStaff, type TaskSetItem, type TemplateItem } from "./TemplateDialog";
import { MoveToSetDialog, TaskSetsPanel } from "./TaskSets";
import BulkAssignDialog from "./BulkAssignDialog";
import { deleteTemplates, reopenTask } from "./actions";
import { CATEGORY_ICONS, DISPLAY_STATUS, PRIORITY_LABELS, describeSchedule, type DisplayStatus } from "@/lib/checklist";
import { formatTime } from "@/lib/time";

export type ReportItem = {
  id: string;
  /** Việc giao theo ca + người đang có ca trùng giờ việc */
  byShift: boolean;
  shiftStaff: string[];
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
  /** Ảnh đã được tự dọn (quá 3 tháng) */
  photoPurged: boolean;
  canReopen: boolean;
};

type Props = {
  tab: "report" | "templates";
  report: ReportItem[];
  templates: TemplateItem[];
  sets: TaskSetItem[];
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

export default function ManageChecklistView({ tab, report, templates, sets, branches, dateLabel }: Props) {
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<TemplateItem | "new" | null>(null);
  const [copying, setCopying] = useState<TemplateItem | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [movingToSet, setMovingToSet] = useState(false);
  const setNames = new Map(sets.map((x) => [x.id, x.name]));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // "all" | "unassigned" | id nhân viên (người chính hoặc người thay)
  const [filter, setFilter] = useState<string>("all");
  const notify = useCallback((message: string) => setToast(message), []);
  const [deleting, startDeleting] = useTransition();

  /** Xóa 1 hoặc nhiều mẫu (sau khi hỏi lại) */
  const removeTemplates = (ids: string[], afterDone?: () => void) => {
    const titles = templates.filter((t) => ids.includes(t.id)).map((t) => `• ${t.title}`);
    const list = titles.slice(0, 10).join("\n") + (titles.length > 10 ? `\n… và ${titles.length - 10} việc khác` : "");
    if (!window.confirm(`Xóa ${ids.length} công việc?\n${list}\n\nViệc chưa làm từ hôm nay sẽ bị hủy. Báo cáo các ngày cũ vẫn được giữ.`)) return;
    startDeleting(async () => {
      const result = await deleteTemplates(ids);
      notify(result.message);
      if (result.ok) {
        setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
        afterDone?.();
      }
    });
  };

  const isUnassigned = (t: TemplateItem) => !t.primaryId && !t.assignByShift;
  const unassignedCount = templates.filter(isUnassigned).length;
  const shiftCount = templates.filter((t) => t.assignByShift).length;
  const assignees = [
    ...new Map(
      templates.flatMap((t) => [
        ...(t.primaryId && t.primaryName ? [[t.primaryId, t.primaryName] as const] : []),
        ...(t.backupId && t.backupName ? [[t.backupId, t.backupName] as const] : []),
      ])
    ),
  ].sort((a, b) => a[1].localeCompare(b[1], "vi"));
  const visible = templates.filter((t) =>
    filter === "all"
      ? true
      : filter === "unassigned"
        ? isUnassigned(t)
        : filter === "shift"
          ? t.assignByShift
          : filter.startsWith("set:")
            ? t.setId === filter.slice(4)
            : t.primaryId === filter || t.backupId === filter
  );
  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id));
  const toggleMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

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
                    {item.photoPurged && (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-center text-[10px] leading-tight text-neutral-400" title="Ảnh cũ hơn 3 tháng đã được tự xóa">
                        Ảnh đã dọn
                      </span>
                    )}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{CATEGORY_ICONS[item.category] ?? "📌"} {item.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                      </div>
                      <p className="mt-0.5 text-neutral-500">
                        {item.branchName} · {formatTime(item.startAt)}–{formatTime(item.dueAt)} ·{" "}
                        {item.byShift ? (
                          item.shiftStaff.length > 0 ? (
                            <>🕒 Ca: {item.shiftStaff.join(", ")}</>
                          ) : (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Không có người trong ca</span>
                          )
                        ) : (
                          item.primaryName
                        )}
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
          <TaskSetsPanel
            sets={sets}
            templates={templates}
            branches={branches}
            notify={notify}
            onSelect={(ids) => toggleMany(ids, true)}
            onAssign={(ids) => {
              setSelected(new Set(ids));
              setAssigning(true);
            }}
          />
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-sm">
                {(
                  [
                    ["all", `Tất cả (${templates.length})`],
                    ["unassigned", `Chưa giao (${unassignedCount})`],
                    ["shift", `Theo ca (${shiftCount})`],
                  ] as const
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={`rounded-md px-3 py-1.5 font-medium ${filter === value ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {assignees.length > 0 && (
                <select
                  aria-label="Lọc theo nhân viên"
                  value={["all", "unassigned", "shift"].includes(filter) || filter.startsWith("set:") ? "" : filter}
                  onChange={(e) => setFilter(e.target.value || "all")}
                  className="input w-auto py-1.5 text-sm"
                >
                  <option value="">Theo nhân viên…</option>
                  {assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              )}
              {sets.length > 0 && (
                <select
                  aria-label="Lọc theo bộ việc"
                  value={filter.startsWith("set:") ? filter : ""}
                  onChange={(e) => setFilter(e.target.value || "all")}
                  className="input w-auto py-1.5 text-sm"
                >
                  <option value="">Theo bộ việc…</option>
                  {sets.map((x) => <option key={x.id} value={`set:${x.id}`}>{x.name}</option>)}
                </select>
              )}
            </div>
            <button type="button" onClick={() => setEditing("new")} className="btn-primary" disabled={branches.length === 0}>
              + Tạo công việc
            </button>
          </div>
          {visible.length === 0 ? (
            <div className="card px-6 py-10 text-center text-sm text-neutral-500">
              {templates.length === 0 ? "Chưa có mẫu công việc nào." : "Không có mẫu nào khớp bộ lọc."}
            </div>
          ) : (
            <>
            <label className="mb-2 flex cursor-pointer items-center gap-3 px-1 text-sm text-neutral-600">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => toggleMany(visible.map((t) => t.id), !allVisibleSelected)}
                className="h-4 w-4 accent-neutral-900"
              />
              Chọn tất cả {visible.length} mẫu đang hiện
            </label>
            <ul className={`space-y-3 ${selected.size > 0 ? "pb-20" : ""}`}>
              {visible.map((t) => (
                <li key={t.id} className={`card p-4 ${t.isActive ? "" : "opacity-60"} ${selected.has(t.id) ? "ring-2 ring-neutral-900" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${t.title}`}
                      checked={selected.has(t.id)}
                      onChange={() => toggleMany([t.id], !selected.has(t.id))}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-neutral-900"
                    />
                    <div className="min-w-0 flex-1 text-sm">
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
                        {t.setId && setNames.has(t.setId) && <span className="text-neutral-700"> · 📁 {setNames.get(t.setId)}</span>}
                      </p>
                      <p className="mt-0.5 text-neutral-700">
                        {t.assignByShift ? (
                          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">🕒 Theo ca</span>
                        ) : t.primaryName ? (
                          <>👤 {t.primaryName}</>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Chưa giao</span>
                        )}
                        {t.backupName && <span className="text-neutral-500"> · thay: {t.backupName}</span>}
                        {t.requiresPhoto && <span className="text-neutral-500"> · 📷</span>}
                        {t.requiresNote && <span className="text-neutral-500"> · 📝</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                      <button type="button" onClick={() => setEditing(t)} className="btn-secondary px-3 py-1.5">Sửa</button>
                      <button type="button" onClick={() => setCopying(t)} className="btn-secondary px-3 py-1.5">Sao chép</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            </>
          )}

          {selected.size > 0 && (
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-neutral-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
              <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
                <span className="text-sm font-medium">Đã chọn {selected.size}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelected(new Set())} className="btn-secondary px-3 py-1.5">Bỏ chọn</button>
                  <button type="button" onClick={() => removeTemplates([...selected])} disabled={deleting} className="btn-danger px-3 py-1.5">
                    {deleting ? "Đang xóa..." : "Xóa"}
                  </button>
                  <button type="button" onClick={() => setMovingToSet(true)} className="btn-secondary px-3 py-1.5">Đưa vào bộ</button>
                  <button type="button" onClick={() => setAssigning(true)} className="btn-primary px-3 py-1.5">Giao việc</button>
                </div>
              </div>
            </div>
          )}

          <TemplateDialog
            key={editing === "new" ? "new" : editing ? editing.id : copying ? `copy-${copying.id}` : "none"}
            template={editing && editing !== "new" ? editing : undefined}
            copyFrom={copying ?? undefined}
            branches={branches}
            sets={sets}
            open={editing !== null || copying !== null}
            deleting={deleting}
            onDelete={editing && editing !== "new" ? () => removeTemplates([editing.id], () => setEditing(null)) : undefined}
            onClose={() => {
              setEditing(null);
              setCopying(null);
            }}
            onDone={(message) => {
              setEditing(null);
              setCopying(null);
              notify(message);
            }}
          />
          <MoveToSetDialog
            key={movingToSet ? `move-${[...selected].join()}` : "move-closed"}
            selected={templates.filter((t) => selected.has(t.id))}
            sets={sets}
            branches={branches}
            open={movingToSet}
            onClose={() => setMovingToSet(false)}
            onDone={(message) => {
              setMovingToSet(false);
              setSelected(new Set());
              notify(message);
            }}
          />
          <BulkAssignDialog
            key={assigning ? [...selected].join() : "closed"}
            selected={templates.filter((t) => selected.has(t.id))}
            allTemplates={templates}
            branches={branches}
            open={assigning}
            onClose={() => setAssigning(false)}
            onDone={(message) => {
              setAssigning(false);
              setSelected(new Set());
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
