"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { cancelReceipt } from "../../actions";

export default function CancelReceiptButton({ receiptId }: { receiptId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(cancelReceipt.bind(null, receiptId), () => setOpen(false));

  return (
    <>
      <button type="button" className="btn-secondary text-red-700" onClick={() => setOpen(true)}>Hủy phiếu</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Hủy phiếu nhập"
        description="Số lượng của phiếu sẽ bị trừ khỏi tồn kho. Phiếu vẫn được giữ lại để tra cứu. Nếu nhập sai, hãy hủy rồi nhập lại phiếu đúng."
      >
        <ActionForm action={action} className="space-y-4">
          <div>
            <label htmlFor="cancel-reason" className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do hủy</label>
            <input id="cancel-reason" name="reason" className="input" required maxLength={500} autoFocus placeholder="vd: Nhập sai số lượng" />
            {state.fieldErrors?.reason && <p className="field-error">{state.fieldErrors.reason}</p>}
          </div>
          {state.message && !state.ok && !state.fieldErrors && <p className="alert-error">{state.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Không</button>
            <SubmitButton pending={pending} variant="danger">Hủy phiếu</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}
