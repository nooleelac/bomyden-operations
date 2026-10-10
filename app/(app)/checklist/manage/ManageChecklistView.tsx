"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import TemplateDialog, { type BranchStaff, type TaskSetItem, type TemplateItem } from "./TemplateDialog";
import { MoveToSetDialog, TaskSetsPanel } from "./TaskSets";
import ImportDialog from "./ImportDialog";
import BulkAssignDialog from "./BulkAssignDialog";
import Link from "next/link";
import { deleteTemplates, reopenTask, resolveUrgentTask } from "./actions";
import { CATEGORY_ICONS, DISPLAY_STATUS, PRIORITY_LABELS, describeSchedule, type DisplayStatus } from "@/lib/checklist";
import { formatTime } from "@/lib/time";

export type ReportItem = {
  id: string;
  taskDate: string;
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
  /** NV báo cần gấp; đã xử lý lúc / bởi ai */
  isUrgent: boolean;
  urgentResolvedAt: string | null;
  urgentResolvedByName: string | null;
};

type Props = {
  tab: "report" | "templates";
  report: ReportItem[];
  templates: TemplateItem[];
  sets: TaskSetItem[];
  branches: BranchStaff[];
  dateLabel: string;
  /** Chỉ hiện việc báo cần gấp (?urgent=1) */
  urgentOnly: boolean;
  /** Đang xem nhiều ngày → nhóm theo ngày + bảng tổng hợp theo nhân viên */
  multiDay: boolean;
  urgentHref: string;
  allHref: string;
};

function ReopenButton({ id, title, onDone }: { id: string; title: string; onDone: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(reopenTask.bind(null, id), (r) => {
    setOpen(false);
    onDone(r.message);
  });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
        ↺ Yêu cầu làm lại
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

/** QL/QTV xác nhận đã xử lý việc nhân viên báo gấp */
function ResolveUrgentButton({ id, onDone }: { id: string; onDone: (m: string) => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await resolveUrgentTask(id);
          onDone(result.message);
        })
      }
      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
    >
      {pending ? "Đang lưu..." : "✓ Đã xử lý"}
    </button>
  );
}

const ORDER: DisplayStatus[] = ["overdue", "failed", "open", "upcoming", "late", "done"];

export default function ManageChecklistView({ tab, report, templates, sets, branches, dateLabel, urgentOnly, urgentHref, allHref, multiDay }: Props) {
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState<TemplateItem | "new" | null>(null);
  const [copying, setCopying] = useState<TemplateItem | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [movingToSet, setMovingToSet] = useState(false);
  const [importing, setImporting] = useState(false);
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
  const openUrgent = (r: ReportItem) => r.isUrgent && !r.urgentResolvedAt;
  const urgentCount = report.filter(openUrgent).length;
  const sorted = [...report].filter((r) => !urgentOnly || r.isUrgent).sort(
    // Việc báo gấp chưa xử lý luôn lên đầu
    (a, b) => Number(openUrgent(b)) - Number(openUrgent(a)) || ORDER.indexOf(a.displayStatus) - ORDER.indexOf(b.displayStatus) || a.dueAt.localeCompare(b.dueAt)
  );
  // Nhóm theo ngày (mới nhất trước)
  const byDay = new Map<string, ReportItem[]>();
  for (const r of sorted) byDay.set(r.taskDate, [...(byDay.get(r.taskDate) ?? []), r]);
  const groups = [...byDay].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <>
      {tab === "report" ? (
        <section>
          {(urgentCount > 0 || urgentOnly) && (
            <div className={`mb-4 flex items-center gap-3 rounded-2xl border p-3 ${urgentCount ? "border-red-200 bg-red-50" : "border-neutral-200 bg-white"}`}>
              <span className="text-2xl" aria-hidden="true">🚨</span>
              <p className="min-w-0 flex-1 text-sm">
                {urgentCount ? (
                  <span className="font-semibold text-red-700">{urgentCount} việc nhân viên báo cần gấp chưa xử lý</span>
                ) : (
                  <span className="text-neutral-600">Không còn việc gấp nào chưa xử lý</span>
                )}
              </p>
              <Link
                href={urgentOnly ? allHref : urgentHref}
                scroll={false}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${urgentOnly ? "border border-neutral-300 bg-white text-neutral-700" : "bg-red-600 text-white"}`}
              >
                {urgentOnly ? "Xem tất cả" : "Chỉ xem việc gấp"}
              </Link>
            </div>
          )}

          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {ORDER.map((s) => (
              <div key={s} className={`rounded-xl px-2 py-2.5 text-center ${DISPLAY_STATUS[s].className}`}>
                <p className="text-xl font-bold tabular-nums">{counts[s]}</p>
                <p className="text-xs leading-tight">{DISPLAY_STATUS[s].label}</p>
              </div>
            ))}
          </div>

          {sorted.length === 0 ? (
            <div className="card px-6 py-10 text-center text-sm text-neutral-500">
              {urgentOnly ? "Không có việc báo gấp" : "Không có công việc nào"} {dateLabel}.
            </div>
          ) : (
            <div className="space-y-5">
              {multiDay && <StaffSummary report={report} />}
              {groups.map(([day, items]) => (
              <section key={day}>
              {multiDay && <DayHeader day={day} items={items} />}
            <ul className="card divide-y divide-neutral-100 overflow-hidden">
              {items.map((item) => {
                const status = DISPLAY_STATUS[item.displayStatus];
                const urgentOpen = openUrgent(item);
                return (
                  <li key={item.id} className={`flex gap-3 p-4 ${urgentOpen ? "bg-red-50/60 shadow-[inset_4px_0_0_var(--color-red-600)]" : ""}`}>
                    {item.photoUrl && (
                      <a href={item.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={item.photoUrl} alt="Ảnh hoàn thành" loading="lazy" className="h-16 w-16 rounded-lg object-cover" />
                      </a>
                    )}
                    {item.photoPurged && (
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-center text-[10px] leading-tight text-neutral-400" title="Ảnh cũ hơn 3 tháng đã được tự xóa">
                        Ảnh đã dọn
                      </span>
                    )}
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{CATEGORY_ICONS[item.category] ?? "📌"} {item.title}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                        {item.isUrgent && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${urgentOpen ? "bg-red-600 text-white" : "bg-neutral-100 text-neutral-500 line-through"}`}>
                            🚨 Cần gấp
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-neutral-500">
                        {item.branchName} · <span className="tabular-nums">{formatTime(item.startAt)}–{formatTime(item.dueAt)}</span> ·{" "}
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
                        <p className="mt-1 text-xs text-neutral-500">
                          ✓ {item.completedByName} · <span className="tabular-nums">{formatTime(item.completedAt)}</span>
                        </p>
                      )}
                      {item.note && (
                        // Ghi chú của nhân viên: luôn nổi bật màu đỏ để QL/QTV không bỏ sót
                        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-700">
                          📝 {item.note}
                        </p>
                      )}
                      {item.isUrgent && item.urgentResolvedAt && (
                        <p className="mt-1.5 text-xs text-emerald-700">
                          ✓ Đã xử lý{item.urgentResolvedByName ? ` bởi ${item.urgentResolvedByName}` : ""} · <span className="tabular-nums">{formatTime(item.urgentResolvedAt)}</span>
                        </p>
                      )}
                      {(urgentOpen || item.canReopen) && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          {urgentOpen && <ResolveUrgentButton id={item.id} onDone={notify} />}
                          {item.canReopen && <ReopenButton id={item.id} title={item.title} onDone={notify} />}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
              </section>
              ))}
            </div>
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
                    className={`rounded-md px-3 py-1.5 font-medium ${filter === value ? "bg-brand text-brand-fg" : "text-neutral-600"}`}
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
            <div className="flex gap-2">
              <button type="button" onClick={() => setImporting(true)} className="btn-secondary" disabled={branches.length === 0}>
                Nhập Excel
              </button>
              <button type="button" onClick={() => setEditing("new")} className="btn-primary" disabled={branches.length === 0}>
                + Tạo công việc
              </button>
            </div>
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
                className="h-4 w-4 accent-brand"
              />
              Chọn tất cả {visible.length} mẫu đang hiện
            </label>
            <ul className={`space-y-3 ${selected.size > 0 ? "pb-20" : ""}`}>
              {visible.map((t) => (
                <li key={t.id} className={`card p-4 ${t.isActive ? "" : "opacity-60"} ${selected.has(t.id) ? "ring-2 ring-brand" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${t.title}`}
                      checked={selected.has(t.id)}
                      onChange={() => toggleMany([t.id], !selected.has(t.id))}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
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
            <div className="fixed inset-x-0 bottom-(--nav-h) z-40 border-t border-neutral-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
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
          <ImportDialog
            key={importing ? "import-open" : "import-closed"}
            branches={branches}
            open={importing}
            onClose={() => setImporting(false)}
            onDone={(message) => {
              setImporting(false);
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
        <p role="status" className="alert-success fixed inset-x-4 bottom-[calc(var(--nav-h)+1rem)] z-50 shadow-lg sm:left-auto sm:right-6 sm:w-96">
          {toast}
        </p>
      )}
    </>
  );
}

const WEEKDAY_NAMES = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

/** Tiêu đề ngày khi xem nhiều ngày: "Thứ hai, 06/10/2026 · 8/10 xong" */
function DayHeader({ day, items }: { day: string; items: ReportItem[] }) {
  const [y, m, d] = day.split("-");
  const weekday = WEEKDAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()];
  const finished = items.filter((i) => i.displayStatus === "done" || i.displayStatus === "late").length;
  const bad = items.filter((i) => i.displayStatus === "failed" || i.displayStatus === "overdue").length;
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
      <h3 className="text-sm font-semibold">
        {weekday}, <span className="tabular-nums">{d}/{m}/{y}</span>
      </h3>
      <p className="shrink-0 text-xs text-neutral-500">
        <span className="tabular-nums">{finished}/{items.length}</span> xong
        {bad > 0 && <span className="ml-1.5 font-medium text-red-700">· {bad} lỗi</span>}
      </p>
    </div>
  );
}

/** Người chịu trách nhiệm một việc: người đã đánh dấu, chưa đánh dấu thì người được giao / người trong ca */
function responsibleOf(item: ReportItem): string[] {
  if (item.completedByName) return [item.completedByName];
  if (item.byShift) return item.shiftStaff;
  return item.primaryName && item.primaryName !== "—" ? [item.primaryName] : [];
}

/** Bảng tổng hợp theo nhân viên cho khoảng nhiều ngày */
function StaffSummary({ report }: { report: ReportItem[] }) {
  type Row = { name: string; done: number; late: number; failed: number; overdue: number; total: number };
  const rows = new Map<string, Row>();
  for (const item of report) {
    if (item.displayStatus === "upcoming" || item.displayStatus === "open") continue; // chưa tới hạn → chưa tính
    for (const name of responsibleOf(item)) {
      const row = rows.get(name) ?? { name, done: 0, late: 0, failed: 0, overdue: 0, total: 0 };
      if (item.displayStatus === "done") row.done++;
      else if (item.displayStatus === "late") row.late++;
      else if (item.displayStatus === "failed") row.failed++;
      else if (item.displayStatus === "overdue") row.overdue++;
      row.total++;
      rows.set(name, row);
    }
  }
  const list = [...rows.values()].sort((a, b) => b.failed + b.overdue - (a.failed + a.overdue) || a.name.localeCompare(b.name, "vi"));
  if (list.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <h3 className="border-b border-neutral-100 px-4 py-3 text-sm font-semibold">Tổng hợp theo nhân viên</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-xs text-neutral-500">
              <th className="px-3 py-2 text-left font-medium sm:px-4">Nhân viên</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-2">Đúng</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-2">Trễ</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-2">Lỗi</th>
              <th className="px-3 py-2 text-right font-medium sm:px-4">Tỉ lệ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {list.map((r) => {
              const rate = r.total ? Math.round((r.done / r.total) * 100) : 0;
              return (
                <tr key={r.name}>
                  <td className="max-w-0 truncate px-3 py-2.5 font-medium sm:px-4">{r.name}</td>
                  <td className="w-1 px-1.5 py-2.5 text-right tabular-nums text-emerald-700 sm:px-2">{r.done}</td>
                  <td className="w-1 px-1.5 py-2.5 text-right tabular-nums text-amber-700 sm:px-2">{r.late || "—"}</td>
                  <td className={`w-1 px-1.5 py-2.5 text-right tabular-nums sm:px-2 ${r.failed + r.overdue ? "font-semibold text-red-700" : "text-neutral-400"}`}>
                    {r.failed + r.overdue || "—"}
                  </td>
                  <td className="w-1 px-3 py-2.5 text-right sm:px-4">
                    <span className={`inline-block min-w-12 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${rate >= 90 ? "bg-emerald-50 text-emerald-700" : rate >= 70 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}>
                      {rate}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-500">
        Đúng = xong đúng hạn · Lỗi = không đạt + quá hạn chưa làm · Tỉ lệ = đúng hạn / tổng việc đã tới hạn.
      </p>
    </section>
  );
}
