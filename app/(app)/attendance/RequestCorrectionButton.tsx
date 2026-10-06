"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { requestCorrection } from "./actions";
import { formatDateTime, toLocalInput } from "@/lib/time";

type Props = {
  attendanceId: string;
  checkInAt: string;
  checkOutAt: string | null;
  label?: string;
  primary?: boolean;
};

export default function RequestCorrectionButton({ attendanceId, checkInAt, checkOutAt, label = "Yêu cầu sửa", primary }: Props) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useFormAction(requestCorrection.bind(null, attendanceId), () => setOpen(false));
  const maxLocal = toLocalInput(new Date().toISOString());

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={primary ? "btn-primary" : "btn-secondary px-3 py-1.5 text-xs"}
      >
        {label}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Yêu cầu sửa chấm công"
        description={`Ca vào lúc ${formatDateTime(checkInAt)}. Nhập giờ đúng, quản lý sẽ xem và duyệt.`}
      >
        <ActionForm action={formAction} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`ci-${attendanceId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">
                Giờ vào đúng
              </label>
              <input
                id={`ci-${attendanceId}`}
                name="check_in"
                type="datetime-local"
                required
                max={maxLocal}
                defaultValue={toLocalInput(checkInAt)}
                className="input"
              />
              {state.fieldErrors?.check_in && <p className="field-error">{state.fieldErrors.check_in}</p>}
            </div>
            <div>
              <label htmlFor={`co-${attendanceId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">
                Giờ ra đúng
              </label>
              <input
                id={`co-${attendanceId}`}
                name="check_out"
                type="datetime-local"
                required
                max={maxLocal}
                defaultValue={checkOutAt ? toLocalInput(checkOutAt) : ""}
                className="input"
              />
              {state.fieldErrors?.check_out && <p className="field-error">{state.fieldErrors.check_out}</p>}
            </div>
          </div>
          <div>
            <label htmlFor={`rs-${attendanceId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">
              Lý do
            </label>
            <textarea
              id={`rs-${attendanceId}`}
              name="reason"
              rows={3}
              required
              maxLength={500}
              placeholder="Ví dụ: Quên bấm ra ca, thực tế về lúc 22:00."
              className="input"
            />
            {state.fieldErrors?.reason && <p className="field-error">{state.fieldErrors.reason}</p>}
          </div>
          {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Hủy</button>
            <SubmitButton pending={pending} pendingText="Đang gửi...">Gửi yêu cầu</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}
