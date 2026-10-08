"use client";

import { startTransition, useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { cancelShift, createShift, deleteShift, updateShift } from "./actions";
import { dayLabel, type ScheduleShift } from "@/lib/schedule";
import type { ActionState } from "@/lib/action-state";

export type TemplateOption = { id: string; name: string; startTime: string; endTime: string };

type Props = {
  branchId: string;
  branchName: string;
  staff: { id: string; name: string }[];
  templates: TemplateOption[];
  /** Ca đang sửa, hoặc ngày để thêm ca mới */
  shift?: ScheduleShift;
  day?: string;
  onClose: () => void;
  onDone: (message: string) => void;
};

function Err({ state, name }: { state: ActionState; name: string }) {
  return state.fieldErrors?.[name] ? <p className="field-error">{state.fieldErrors[name]}</p> : null;
}

export default function ShiftDialog({ branchId, branchName, staff, templates, shift, day, onClose, onDone }: Props) {
  const published = shift?.status === "published";
  const [times, setTimes] = useState({ start: shift?.start_time ?? templates[0]?.startTime ?? "08:00", end: shift?.end_time ?? templates[0]?.endTime ?? "14:00" });
  const [templateId, setTemplateId] = useState(shift ? (shift.template_id ?? "") : (templates[0]?.id ?? ""));
  const [cancelling, setCancelling] = useState(false);
  const action = shift ? updateShift.bind(null, shift.id, published) : createShift.bind(null, branchId);
  const [state, formAction, pending] = useFormAction(action, (r) => onDone(r.message));
  const [cancelState, cancelAction, cancelPending] = useFormAction(cancelShift.bind(null, shift?.id ?? ""), (r) => onDone(r.message));
  const [deleteState, deleteAction, deletePending] = useFormAction(() => deleteShift(shift!.id), (r) => onDone(r.message));
  const label = "mb-1.5 block text-sm font-medium text-neutral-700";
  const date = shift?.work_date ?? day ?? "";
  const staffOptions = shift && !staff.some((s) => s.id === shift.employee_id) ? [{ id: shift.employee_id, name: shift.employee_name }, ...staff] : staff;

  return (
    <Dialog
      open
      onClose={onClose}
      title={shift ? (published ? "Ca đã công bố" : "Sửa ca (nháp)") : "Thêm ca"}
      description={`${branchName} · ${date ? dayLabel(date) : ""}`}
    >
      {cancelling ? (
        <ActionForm action={cancelAction} className="space-y-4">
          <p className="text-sm text-neutral-600">
            Ca {shift?.start_time}–{shift?.end_time} của {shift?.employee_name} sẽ bị hủy. Nhân viên vẫn thấy ca bị gạch kèm lý do.
          </p>
          <div>
            <label htmlFor="sh-cancel" className={label}>Lý do hủy</label>
            <textarea id="sh-cancel" name="cancel_reason" rows={2} required maxLength={200} className="input" />
            <Err state={cancelState} name="cancel_reason" />
          </div>
          {cancelState.message && !cancelState.ok && <p role="alert" className="alert-error">{cancelState.message}</p>}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={() => setCancelling(false)} className="btn-secondary">Quay lại</button>
            <SubmitButton pending={cancelPending} variant="danger">Hủy ca</SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <ActionForm action={formAction} className="space-y-4">
          <input type="hidden" name="work_date" value={date} />
          <div>
            <label htmlFor="sh-emp" className={label}>Nhân viên</label>
            <select id="sh-emp" name="employee_id" required defaultValue={shift?.employee_id ?? ""} className="input">
              <option value="">— Chọn —</option>
              {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Err state={state} name="employee_id" />
          </div>

          {published ? (
            <>
              <input type="hidden" name="start_time" value={times.start} />
              <input type="hidden" name="end_time" value={times.end} />
              <input type="hidden" name="template_id" value={templateId} />
              <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm">
                Giờ làm: <strong>{times.start}–{times.end}</strong>. Ca đã công bố không đổi giờ được — hãy hủy và thêm ca mới.
              </p>
            </>
          ) : (
            <>
              {templates.length > 0 && (
                <div>
                  <label htmlFor="sh-tpl" className={label}>Mẫu ca</label>
                  <select
                    id="sh-tpl"
                    name="template_id"
                    value={templateId}
                    onChange={(e) => {
                      setTemplateId(e.target.value);
                      const t = templates.find((x) => x.id === e.target.value);
                      if (t) setTimes({ start: t.startTime, end: t.endTime });
                    }}
                    className="input"
                  >
                    <option value="">Giờ tùy chỉnh</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.startTime}–{t.endTime})</option>)}
                  </select>
                </div>
              )}
              {templates.length === 0 && <input type="hidden" name="template_id" value="" />}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sh-start" className={label}>Bắt đầu</label>
                  <input id="sh-start" name="start_time" type="time" required value={times.start}
                    onChange={(e) => { setTimes((t) => ({ ...t, start: e.target.value })); setTemplateId(""); }} className="input" />
                  <Err state={state} name="start_time" />
                </div>
                <div>
                  <label htmlFor="sh-end" className={label}>Kết thúc</label>
                  <input id="sh-end" name="end_time" type="time" required value={times.end}
                    onChange={(e) => { setTimes((t) => ({ ...t, end: e.target.value })); setTemplateId(""); }} className="input" />
                  <Err state={state} name="end_time" />
                </div>
              </div>
              {times.end <= times.start && times.end !== times.start && (
                <p className="text-xs text-neutral-500">Ca qua đêm: kết thúc lúc {times.end} ngày hôm sau.</p>
              )}
            </>
          )}

          <div>
            <label htmlFor="sh-note" className={label}>Ghi chú</label>
            <input id="sh-note" name="note" maxLength={200} defaultValue={shift?.note ?? ""} placeholder="Ví dụ: Trực quầy nướng" className="input" />
            <Err state={state} name="note" />
          </div>

          {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
          {deleteState.message && !deleteState.ok && <p role="alert" className="alert-error">{deleteState.message}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
            <div>
              {shift && !published && (
                <button type="button" disabled={deletePending}
                  onClick={() => { if (window.confirm("Xóa ca nháp này?")) startTransition(() => deleteAction(new FormData())); }}
                  className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50">
                  {deletePending ? "Đang xóa..." : "Xóa ca"}
                </button>
              )}
              {published && (
                <button type="button" onClick={() => setCancelling(true)} className="text-sm font-medium text-red-700 hover:underline">
                  Hủy ca…
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="btn-secondary">Đóng</button>
              <SubmitButton pending={pending} pendingText="Đang lưu...">{shift ? "Lưu" : "Thêm ca"}</SubmitButton>
            </div>
          </div>
        </ActionForm>
      )}
    </Dialog>
  );
}
