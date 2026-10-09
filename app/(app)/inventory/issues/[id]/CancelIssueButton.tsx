"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { cancelStockIssue } from "../../stock-actions";

export default function CancelIssueButton({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(cancelStockIssue.bind(null, issueId), () => setOpen(false));

  return (
    <>
      <button type="button" className="btn-secondary text-red-700" onClick={() => setOpen(true)}>Hủy phiếu</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Hủy phiếu xuất"
        description="Số lượng của phiếu sẽ được cộng lại vào tồn kho (phiếu chuyển: trừ lại ở chi nhánh nhận). Phiếu vẫn được giữ để tra cứu."
      >
        <ActionForm action={action} className="space-y-4">
          <div>
            <label htmlFor="cancel-reason" className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do hủy</label>
            <input id="cancel-reason" name="reason" className="input" required maxLength={500} autoFocus placeholder="vd: Ghi nhầm số lượng" />
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
