"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import WeekView from "../WeekView";
import ShiftDialog, { type TemplateOption } from "./ShiftDialog";
import BulkShiftDialog from "./BulkShiftDialog";
import {
  copyWeek,
  createShiftTemplate,
  publishWeek,
  reviewRequest,
  saveScheduleSettings,
  setLeavePaid,
  updateShiftTemplate,
} from "./actions";
import { REQUEST_KIND_LABELS, REQUEST_STATUS, addDays, describeRequest, type MyRequest, type ScheduleShift, type WeekSchedule } from "@/lib/schedule";
import { formatDateTime } from "@/lib/time";
import type { ActionState } from "@/lib/action-state";
import type { ScheduleSettings } from "@/lib/database.types";

function useToast() {
  const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  return [toast, notify] as const;
}

function Toast({ message }: { message: string }) {
  return message ? <p role="status" className="alert-success mb-4">{message}</p> : null;
}

function Err({ state, name }: { state: ActionState; name: string }) {
  return state.fieldErrors?.[name] ? <p className="field-error">{state.fieldErrors[name]}</p> : null;
}

// =====================================================================
// XẾP LỊCH
// =====================================================================
export function ScheduleManager({
  branchId,
  branchName,
  weekStart,
  today,
  data,
  staff,
  templates,
}: {
  branchId: string;
  branchName: string;
  weekStart: string;
  today: string;
  data: WeekSchedule;
  staff: { id: string; name: string }[];
  templates: TemplateOption[];
}) {
  const [toast, notify] = useToast();
  const [editing, setEditing] = useState<{ shift?: ScheduleShift; day?: string } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [pubState, pubAction, pubPending] = useFormAction(() => publishWeek(branchId, weekStart), (r) => notify(r.message));
  const [copyState, copyAction, copyPending] = useFormAction(() => copyWeek(branchId, addDays(weekStart, -7), weekStart), (r) => notify(r.message));
  const drafts = data.shifts.filter((s) => s.status === "draft").length;
  const published = data.shifts.filter((s) => s.status === "published").length;
  const error = [pubState, copyState].find((s) => s.message && !s.ok)?.message;

  return (
    <>
      <Toast message={toast} />
      <div className="card mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
        <span className="text-neutral-600">
          <strong>{published}</strong> ca đã công bố · <strong className={drafts ? "text-amber-700" : ""}>{drafts}</strong> ca nháp
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" disabled={staff.length === 0} onClick={() => setBulkOpen(true)} className="btn-secondary">
            Xếp nhanh theo ca
          </button>
          <button
            type="button"
            disabled={copyPending}
            onClick={() => {
              if (window.confirm("Sao chép toàn bộ ca của tuần trước sang tuần này (thành nháp)?")) startTransition(() => copyAction(new FormData()));
            }}
            className="btn-secondary"
          >
            {copyPending ? "Đang sao chép..." : "Sao chép tuần trước"}
          </button>
          <button
            type="button"
            disabled={pubPending || drafts === 0}
            onClick={() => {
              if (window.confirm(`Công bố ${drafts} ca nháp? Sau khi công bố, ca chỉ có thể hủy (không xóa, không đổi giờ).`)) startTransition(() => pubAction(new FormData()));
            }}
            className="btn-primary"
          >
            {pubPending ? "Đang công bố..." : `Công bố tuần (${drafts})`}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="alert-error mb-4">{error}</p>}
      {staff.length === 0 && <p className="alert-error mb-4">Chi nhánh chưa có nhân viên nào.</p>}

      <WeekView
        weekStart={weekStart}
        today={today}
        data={data}
        onAdd={staff.length ? (day) => setEditing({ day }) : undefined}
        onShiftClick={(shift) => setEditing({ shift })}
      />

      {editing && (
        <ShiftDialog
          key={editing.shift?.id ?? editing.day}
          branchId={branchId}
          branchName={branchName}
          staff={staff}
          templates={templates}
          shift={editing.shift}
          day={editing.day}
          onClose={() => setEditing(null)}
          onDone={(m) => {
            setEditing(null);
            notify(m);
          }}
        />
      )}

      {bulkOpen && (
        <BulkShiftDialog
          branchId={branchId}
          branchName={branchName}
          weekStart={weekStart}
          today={today}
          staff={staff}
          templates={templates}
          shifts={data.shifts}
          onClose={() => setBulkOpen(false)}
          onDone={(m) => {
            setBulkOpen(false);
            notify(m);
          }}
        />
      )}
    </>
  );
}

// =====================================================================
// DUYỆT ĐƠN
// =====================================================================
export type ManageRequest = MyRequest & { branch_name: string | null };

function ReviewDialog({ request, isAdmin, onClose, onDone }: { request: ManageRequest; isAdmin: boolean; onClose: () => void; onDone: (m: string) => void }) {
  const [approve, setApprove] = useState(true);
  const [state, action, pending] = useFormAction(reviewRequest.bind(null, request.id, approve), (r) => onDone(r.message));
  return (
    <Dialog open onClose={onClose} title={`${REQUEST_KIND_LABELS[request.kind]} — ${request.employee_name}`} description={describeRequest(request)}>
      <ActionForm action={action} className="space-y-4">
        <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">Lý do: {request.reason}</p>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {[true, false].map((v) => (
            <label key={String(v)} className={`cursor-pointer rounded-lg border px-3 py-2 text-center font-medium ${approve === v ? (v ? "border-emerald-700 bg-emerald-700 text-white" : "border-red-700 bg-red-700 text-white") : "border-neutral-300"}`}>
              <input type="radio" name="decision" checked={approve === v} onChange={() => setApprove(v)} className="sr-only" />
              {v ? "Duyệt" : "Từ chối"}
            </label>
          ))}
        </div>
        {approve && request.kind === "leave" && isAdmin && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 px-3 py-2.5 text-sm">
            <input type="checkbox" name="is_paid" className="mt-0.5 h-4 w-4 accent-neutral-900" />
            <span>
              <span className="font-medium">Nghỉ có lương</span>
              <span className="block text-xs text-neutral-500">Mỗi ngày nghỉ tính 1 ngày công cho nhân viên lương cố định.</span>
            </span>
          </label>
        )}
        {approve && request.kind === "swap" && (
          <p className="text-xs text-neutral-500">Khi duyệt, ca sẽ được chuyển cho người nhận ngay.</p>
        )}
        <div>
          <label htmlFor="rv-note" className="mb-1.5 block text-sm font-medium text-neutral-700">
            {approve ? "Ghi chú (không bắt buộc)" : "Lý do từ chối"}
          </label>
          <textarea id="rv-note" name="review_note" rows={2} maxLength={500} required={!approve} className="input" />
          <Err state={state} name="review_note" />
        </div>
        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Đóng</button>
          <SubmitButton pending={pending} variant={approve ? "primary" : "danger"}>{approve ? "Duyệt đơn" : "Từ chối"}</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

function PaidToggle({ request, onDone }: { request: ManageRequest; onDone: (m: string) => void }) {
  const [state, action, pending] = useFormAction(() => setLeavePaid(request.id, !request.is_paid), (r) => onDone(r.message));
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" disabled={pending} onClick={() => startTransition(() => action(new FormData()))} className="text-xs font-medium text-neutral-600 hover:underline disabled:opacity-50">
        {pending ? "Đang lưu..." : request.is_paid ? "Chuyển thành không lương" : "Đánh dấu có lương"}
      </button>
      {state.message && !state.ok && <span className="max-w-56 text-right text-xs text-red-600">{state.message}</span>}
    </span>
  );
}

function RequestRow({ r, myId, isAdmin, onReview, onDone }: { r: ManageRequest; myId: string; isAdmin: boolean; onReview?: () => void; onDone: (m: string) => void }) {
  const status = REQUEST_STATUS[r.status];
  const self = r.employee_id === myId || r.target_employee_id === myId;
  return (
    <li className="flex items-start justify-between gap-3 p-4 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{r.employee_name}</span>
          <span className="text-neutral-500">· {REQUEST_KIND_LABELS[r.kind]}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
          {r.is_urgent && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Gấp</span>}
          {r.over_limit && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">Vượt giới hạn tháng</span>}
          {r.is_paid && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Có lương</span>}
        </div>
        <p className="mt-0.5 text-neutral-700">{describeRequest(r)}{r.branch_name ? ` · ${r.branch_name}` : ""}</p>
        <p className="mt-0.5 text-neutral-500">Lý do: {r.reason}</p>
        {r.review_note && <p className="mt-0.5 text-neutral-500">Phản hồi{r.reviewer_name ? ` (${r.reviewer_name})` : ""}: {r.review_note}</p>}
        <p className="mt-0.5 text-xs text-neutral-400">Gửi lúc {formatDateTime(r.created_at)}</p>
      </div>
      <div className="shrink-0">
        {onReview && (self ? (
          <span className="text-xs text-neutral-400">Đơn của bạn — người khác duyệt</span>
        ) : (
          <button type="button" onClick={onReview} className="btn-primary">Xử lý</button>
        ))}
        {isAdmin && r.kind === "leave" && r.status === "approved" && <PaidToggle request={r} onDone={onDone} />}
      </div>
    </li>
  );
}

export function RequestsManager({ requests, myId, isAdmin }: { requests: ManageRequest[]; myId: string; isAdmin: boolean }) {
  const [toast, notify] = useToast();
  const [reviewing, setReviewing] = useState<ManageRequest | null>(null);
  const pending = requests.filter((r) => r.status === "pending");
  const waitingPeer = requests.filter((r) => r.status === "awaiting_peer");
  const done = requests.filter((r) => r.status !== "pending" && r.status !== "awaiting_peer");

  return (
    <>
      <Toast message={toast} />
      <section>
        <h2 className="mb-2 font-semibold">Chờ duyệt ({pending.length})</h2>
        {pending.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-neutral-500">Không có đơn nào chờ duyệt.</div>
        ) : (
          <ul className="card divide-y divide-neutral-100">
            {pending.map((r) => <RequestRow key={r.id} r={r} myId={myId} isAdmin={isAdmin} onReview={() => setReviewing(r)} onDone={notify} />)}
          </ul>
        )}
      </section>

      {waitingPeer.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Đang chờ người nhận đồng ý ({waitingPeer.length})</h2>
          <ul className="card divide-y divide-neutral-100">
            {waitingPeer.map((r) => <RequestRow key={r.id} r={r} myId={myId} isAdmin={isAdmin} onDone={notify} />)}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 font-semibold">Đã xử lý gần đây</h2>
        {done.length === 0 ? (
          <div className="card px-6 py-8 text-center text-sm text-neutral-500">Chưa có.</div>
        ) : (
          <ul className="card divide-y divide-neutral-100">
            {done.map((r) => <RequestRow key={r.id} r={r} myId={myId} isAdmin={isAdmin} onDone={notify} />)}
          </ul>
        )}
      </section>

      {reviewing && (
        <ReviewDialog
          request={reviewing}
          isAdmin={isAdmin}
          onClose={() => setReviewing(null)}
          onDone={(m) => {
            setReviewing(null);
            notify(m);
          }}
        />
      )}
    </>
  );
}

// =====================================================================
// MẪU CA
// =====================================================================
export type TemplateRow = TemplateOption & { branchId: string; branchName: string; isActive: boolean; sortOrder: number };

function TemplateDialog({ template, branches, onClose, onDone }: { template?: TemplateRow; branches: { id: string; name: string }[]; onClose: () => void; onDone: (m: string) => void }) {
  const action = template ? updateShiftTemplate.bind(null, template.id) : createShiftTemplate;
  const [state, formAction, pending] = useFormAction(action, (r) => onDone(r.message));
  const label = "mb-1.5 block text-sm font-medium text-neutral-700";
  return (
    <Dialog open onClose={onClose} title={template ? "Sửa mẫu ca" : "Tạo mẫu ca"} description={template?.branchName}>
      <ActionForm action={formAction} className="space-y-4">
        {!template && (
          <div>
            <label htmlFor="st-branch" className={label}>Chi nhánh</label>
            <select id="st-branch" name="branch_id" required defaultValue={branches.length === 1 ? branches[0].id : ""} className="input">
              <option value="">— Chọn —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <Err state={state} name="branch_id" />
          </div>
        )}
        <div>
          <label htmlFor="st-name" className={label}>Tên ca</label>
          <input id="st-name" name="name" required maxLength={50} defaultValue={template?.name} placeholder="Ví dụ: Ca sáng" className="input" />
          <Err state={state} name="name" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="st-start" className={label}>Bắt đầu</label>
            <input id="st-start" name="start_time" type="time" required defaultValue={template?.startTime ?? "08:00"} className="input" />
            <Err state={state} name="start_time" />
          </div>
          <div>
            <label htmlFor="st-end" className={label}>Kết thúc</label>
            <input id="st-end" name="end_time" type="time" required defaultValue={template?.endTime ?? "14:00"} className="input" />
            <Err state={state} name="end_time" />
          </div>
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <div>
            <label htmlFor="st-sort" className={label}>Thứ tự</label>
            <input id="st-sort" name="sort_order" type="number" min={0} max={9999} defaultValue={template?.sortOrder ?? 0} className="input" />
          </div>
          {template && (
            <label className="flex h-[42px] cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 px-3 text-sm">
              <input type="checkbox" name="is_active" defaultChecked={template.isActive} className="h-4 w-4 accent-neutral-900" />
              Đang dùng
            </label>
          )}
        </div>
        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          <SubmitButton pending={pending} pendingText="Đang lưu...">{template ? "Lưu" : "Tạo mẫu ca"}</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function TemplatesManager({ templates, branches }: { templates: TemplateRow[]; branches: { id: string; name: string }[] }) {
  const [toast, notify] = useToast();
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  return (
    <>
      <Toast message={toast} />
      <div className="mb-3 flex justify-end">
        <button type="button" onClick={() => setEditing("new")} className="btn-primary">+ Tạo mẫu ca</button>
      </div>
      {templates.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-neutral-500">Chưa có mẫu ca. Mẫu ca giúp xếp lịch nhanh hơn.</div>
      ) : (
        <ul className="card divide-y divide-neutral-100">
          {templates.map((t) => (
            <li key={t.id} className={`flex items-center justify-between gap-3 p-4 text-sm ${t.isActive ? "" : "opacity-50"}`}>
              <div>
                <p className="font-semibold">{t.name} <span className="font-normal tabular-nums text-neutral-600">{t.startTime}–{t.endTime}</span></p>
                <p className="text-neutral-500">{t.branchName}{t.isActive ? "" : " · Ngừng dùng"}</p>
              </div>
              <button type="button" onClick={() => setEditing(t)} className="btn-secondary">Sửa</button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <TemplateDialog
          template={editing === "new" ? undefined : editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onDone={(m) => {
            setEditing(null);
            notify(m);
          }}
        />
      )}
    </>
  );
}

// =====================================================================
// CÀI ĐẶT (QTV)
// =====================================================================
export function ScheduleSettingsForm({ settings }: { settings: ScheduleSettings }) {
  const [state, action, pending] = useFormAction(saveScheduleSettings);
  const rows = [
    { kind: "Xin nghỉ", notice: "leave_notice_hours", limit: "leave_days_per_month", limitLabel: "ngày/tháng" },
    { kind: "Xin đi trễ", notice: "late_notice_hours", limit: "late_per_month", limitLabel: "lần/tháng" },
    { kind: "Xin về sớm", notice: "early_notice_hours", limit: "early_per_month", limitLabel: "lần/tháng" },
    { kind: "Đổi / nhường ca", notice: "swap_notice_hours", limit: "swap_per_month", limitLabel: "lần/tháng" },
  ] as const;
  return (
    <ActionForm action={action} className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">Quy định đơn xin phép</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Gửi muộn hơn hạn báo trước → đơn được đánh dấu <strong>Gấp</strong>. Vượt số lần → đơn có cảnh báo
          <strong> Vượt giới hạn</strong>. Nhân viên vẫn gửi được, quản lý quyết định duyệt hay không.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-2 pr-3 font-medium">Loại đơn</th>
              <th className="py-2 pr-3 font-medium">Báo trước (giờ)</th>
              <th className="py-2 font-medium">Tối đa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.kind}>
                <td className="py-2 pr-3 font-medium">{r.kind}</td>
                <td className="py-2 pr-3">
                  <input name={r.notice} aria-label={`${r.kind}: báo trước (giờ)`} type="number" min={0} max={720} defaultValue={settings[r.notice]} className="input w-24" />
                  <Err state={state} name={r.notice} />
                </td>
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <input name={r.limit} aria-label={`${r.kind}: tối đa ${r.limitLabel}`} type="number" min={0} max={31} defaultValue={settings[r.limit]} className="input w-20" />
                    <span className="whitespace-nowrap text-xs text-neutral-500">{r.limitLabel}</span>
                  </span>
                  <Err state={state} name={r.limit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-neutral-100 pt-4">
        <h2 className="font-semibold">Nhân viên tự đăng ký ca</h2>
        <label htmlFor="st-reg" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-700">
          Phải đăng ký trước
          <input id="st-reg" name="register_deadline_days" type="number" min={0} max={60} defaultValue={settings.register_deadline_days} className="input w-20" />
          ngày
        </label>
        <p className="mt-1 text-xs text-neutral-500">
          Ví dụ 3: hôm nay chỉ đăng ký / sửa được các ngày từ 3 ngày sau trở đi. Sau hạn, muốn đổi phải gửi đơn như bình thường.
        </p>
        <Err state={state} name="register_deadline_days" />
      </div>
      {state.message && <p role="status" className={state.ok ? "alert-success" : "alert-error"}>{state.message}</p>}
      <div className="flex justify-end">
        <SubmitButton pending={pending} pendingText="Đang lưu...">Lưu cài đặt</SubmitButton>
      </div>
    </ActionForm>
  );
}
