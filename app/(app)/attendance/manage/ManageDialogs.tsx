"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { addManualRecord, correctRecord, reviewCorrection } from "./actions";
import { formatDateTime, toLocalInput } from "@/lib/time";
import type { ActionState } from "@/lib/action-state";

function FieldError({ state, name }: { state: ActionState; name: string }) {
  return state.fieldErrors?.[name] ? <p className="field-error">{state.fieldErrors[name]}</p> : null;
}

function TimeFields({ prefix, state, checkIn, checkOut }: { prefix: string; state: ActionState; checkIn: string; checkOut: string }) {
  const max = toLocalInput(new Date().toISOString());
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor={`${prefix}-in`} className="mb-1.5 block text-sm font-medium text-neutral-700">Giờ vào</label>
        <input id={`${prefix}-in`} name="check_in" type="datetime-local" required max={max} defaultValue={checkIn} className="input" />
        <FieldError state={state} name="check_in" />
      </div>
      <div>
        <label htmlFor={`${prefix}-out`} className="mb-1.5 block text-sm font-medium text-neutral-700">Giờ ra</label>
        <input id={`${prefix}-out`} name="check_out" type="datetime-local" required max={max} defaultValue={checkOut} className="input" />
        <FieldError state={state} name="check_out" />
      </div>
    </div>
  );
}

/** Thông báo kết quả (dữ liệu trang tự làm mới nhờ revalidatePath trong action). */
function useDone(onDone: (message: string) => void) {
  return (result: ActionState) => onDone(result.message);
}

// =====================================================================
// DUYỆT YÊU CẦU
// =====================================================================
export function ReviewCorrection({
  correctionId,
  requestedIn,
  requestedOut,
  onDone,
}: {
  correctionId: string;
  requestedIn: string;
  requestedOut: string;
  onDone: (message: string) => void;
}) {
  const [panel, setPanel] = useState<"approve" | "reject" | null>(null);
  const done = useDone(onDone);
  const close = () => setPanel(null);
  const [approveState, approveAction, approvePending] = useFormAction(
    reviewCorrection.bind(null, correctionId, true),
    (r) => { close(); done(r); }
  );
  const [rejectState, rejectAction, rejectPending] = useFormAction(
    reviewCorrection.bind(null, correctionId, false),
    (r) => { close(); done(r); }
  );

  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => setPanel("approve")} className="btn-primary px-3 py-1.5">Duyệt</button>
      <button type="button" onClick={() => setPanel("reject")} className="btn-secondary px-3 py-1.5">Từ chối</button>

      <Dialog open={panel === "approve"} onClose={close} title="Duyệt yêu cầu sửa" description="Có thể chỉnh lại giờ trước khi duyệt.">
        <ActionForm action={approveAction} className="space-y-4">
          <TimeFields prefix={`ap-${correctionId}`} state={approveState} checkIn={toLocalInput(requestedIn)} checkOut={toLocalInput(requestedOut)} />
          <div>
            <label htmlFor={`ap-note-${correctionId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">Ghi chú (tùy chọn)</label>
            <input id={`ap-note-${correctionId}`} name="note" maxLength={500} className="input" />
          </div>
          {approveState.message && !approveState.ok && <p role="alert" className="alert-error">{approveState.message}</p>}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={close} className="btn-secondary">Hủy</button>
            <SubmitButton pending={approvePending}>Duyệt & cập nhật</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>

      <Dialog open={panel === "reject"} onClose={close} title="Từ chối yêu cầu sửa">
        <ActionForm action={rejectAction} className="space-y-4">
          <div>
            <label htmlFor={`rj-note-${correctionId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do từ chối</label>
            <textarea id={`rj-note-${correctionId}`} name="note" rows={3} required maxLength={500} className="input" />
            <FieldError state={rejectState} name="note" />
          </div>
          {rejectState.message && !rejectState.ok && <p role="alert" className="alert-error">{rejectState.message}</p>}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={close} className="btn-secondary">Hủy</button>
            <SubmitButton pending={rejectPending} variant="danger">Từ chối</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </div>
  );
}

// =====================================================================
// SỬA TRỰC TIẾP
// =====================================================================
export function EditRecordButton({
  recordId,
  employeeName,
  checkIn,
  checkOut,
  onDone,
}: {
  recordId: string;
  employeeName: string;
  checkIn: string;
  checkOut: string | null;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const done = useDone(onDone);
  const [state, action, pending] = useFormAction(correctRecord.bind(null, recordId), (r) => {
    setOpen(false);
    done(r);
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary px-3 py-1.5 text-xs">Sửa giờ</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Sửa giờ chấm công" description={`${employeeName} · vào lúc ${formatDateTime(checkIn)}`}>
        <ActionForm action={action} className="space-y-4">
          <TimeFields prefix={`ed-${recordId}`} state={state} checkIn={toLocalInput(checkIn)} checkOut={checkOut ? toLocalInput(checkOut) : ""} />
          <div>
            <label htmlFor={`ed-reason-${recordId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do sửa</label>
            <textarea id={`ed-reason-${recordId}`} name="reason" rows={2} required maxLength={500} className="input" />
            <FieldError state={state} name="reason" />
          </div>
          {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Hủy</button>
            <SubmitButton pending={pending}>Lưu</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}

// =====================================================================
// THÊM CA THỦ CÔNG
// =====================================================================
export type StaffOption = { id: string; name: string; branches: { id: string; name: string }[] };

export function AddManualButton({ staff, onDone }: { staff: StaffOption[]; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [employeeId, setEmployeeId] = useState("");
  const done = useDone(onDone);
  const [state, action, pending] = useFormAction(addManualRecord, (r) => {
    setOpen(false);
    setFormKey((k) => k + 1);
    setEmployeeId("");
    done(r);
  });
  const branches = staff.find((s) => s.id === employeeId)?.branches ?? [];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary" disabled={staff.length === 0}>
        + Thêm ca thủ công
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Thêm ca thủ công" description="Dùng khi nhân viên quên vào ca hoàn toàn.">
        <ActionForm key={formKey} action={action} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mn-emp" className="mb-1.5 block text-sm font-medium text-neutral-700">Nhân viên</label>
              <select id="mn-emp" name="employee_id" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="input">
                <option value="">— Chọn —</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <FieldError state={state} name="employee_id" />
            </div>
            <div>
              <label htmlFor="mn-branch" className="mb-1.5 block text-sm font-medium text-neutral-700">Chi nhánh</label>
              <select key={employeeId} id="mn-branch" name="branch_id" required defaultValue={branches.length === 1 ? branches[0].id : ""} className="input">
                <option value="">— Chọn —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <FieldError state={state} name="branch_id" />
            </div>
          </div>
          <TimeFields prefix="mn" state={state} checkIn="" checkOut="" />
          <div>
            <label htmlFor="mn-reason" className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do</label>
            <textarea id="mn-reason" name="reason" rows={2} required maxLength={500} className="input" />
            <FieldError state={state} name="reason" />
          </div>
          {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Hủy</button>
            <SubmitButton pending={pending}>Thêm ca</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}
