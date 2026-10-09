"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { PAYMENT_METHOD_LABELS, formatMoney } from "@/lib/inventory";
import { recordPayment, setDueDate, voidPayment } from "./actions";

function todayVn(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
}

/** Nút "Ghi nhận trả tiền" cho 1 phiếu còn nợ (QTV / QL) */
export function RecordPaymentButton({
  receiptId,
  debt,
  label = "💵 Ghi nhận trả tiền",
  compact = false,
}: {
  receiptId: string;
  debt: number;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(Math.round(debt)));
  const [state, action, pending] = useFormAction(recordPayment.bind(null, receiptId), () => setOpen(false));

  return (
    <>
      <button type="button" className={compact ? "btn-secondary px-2.5 py-1.5 text-xs" : "btn-primary"} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Ghi nhận trả tiền nhà cung cấp" description={`Còn nợ ${formatMoney(debt)}`}>
        <ActionForm action={action} className="space-y-4">
          <div>
            <label htmlFor={`pay-amount-${receiptId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">Số tiền trả</label>
            <div className="flex gap-2">
              <input
                id={`pay-amount-${receiptId}`}
                name="amount"
                className="input"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              <button type="button" className="btn-secondary shrink-0" onClick={() => setAmount(String(Math.round(debt)))}>
                Trả hết
              </button>
            </div>
            {state.fieldErrors?.amount && <p className="field-error">{state.fieldErrors.amount}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`pay-date-${receiptId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">Ngày trả</label>
              <input id={`pay-date-${receiptId}`} name="paid_on" type="date" className="input" defaultValue={todayVn()} max={todayVn()} required />
            </div>
            <div>
              <label htmlFor={`pay-method-${receiptId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">Hình thức</label>
              <select id={`pay-method-${receiptId}`} name="method" className="input" defaultValue="transfer">
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor={`pay-note-${receiptId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">Ghi chú</label>
            <input id={`pay-note-${receiptId}`} name="note" className="input" maxLength={300} placeholder="vd: Mã giao dịch ngân hàng" />
          </div>
          {state.message && !state.ok && !state.fieldErrors && <p className="alert-error">{state.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Hủy</button>
            <SubmitButton pending={pending}>Lưu thanh toán</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}

/** Hủy 1 lần thanh toán ghi nhầm */
export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(voidPayment.bind(null, paymentId), () => setOpen(false));
  return (
    <>
      <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setOpen(true)}>Hủy</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Hủy lần thanh toán" description="Số tiền này sẽ được cộng lại vào công nợ của phiếu.">
        <ActionForm action={action} className="space-y-4">
          <div>
            <label htmlFor={`void-${paymentId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">Lý do</label>
            <input id={`void-${paymentId}`} name="reason" className="input" required maxLength={500} autoFocus placeholder="vd: Ghi nhầm số tiền" />
            {state.fieldErrors?.reason && <p className="field-error">{state.fieldErrors.reason}</p>}
          </div>
          {state.message && !state.ok && !state.fieldErrors && <p className="alert-error">{state.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Không</button>
            <SubmitButton pending={pending} variant="danger">Hủy thanh toán</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}

/** Đổi / bỏ hạn thanh toán */
export function DueDateButton({ receiptId, dueDate }: { receiptId: string; dueDate: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useFormAction(setDueDate.bind(null, receiptId), () => setOpen(false));
  return (
    <>
      <button type="button" className="text-xs font-medium text-neutral-600 underline" onClick={() => setOpen(true)}>
        {dueDate ? "Đổi hạn" : "Đặt hạn"}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Hạn thanh toán">
        <ActionForm action={action} className="space-y-4">
          <div>
            <label htmlFor={`due-${receiptId}`} className="mb-1.5 block text-sm font-medium text-neutral-700">
              Hạn thanh toán (để trống = không có hạn)
            </label>
            <input id={`due-${receiptId}`} name="due_date" type="date" className="input" defaultValue={dueDate ?? ""} />
          </div>
          {state.message && !state.ok && <p className="alert-error">{state.message}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Hủy</button>
            <SubmitButton pending={pending}>Lưu</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}
