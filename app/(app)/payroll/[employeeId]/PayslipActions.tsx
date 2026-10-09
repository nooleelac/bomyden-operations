"use client";

import { startTransition, useRef, useState } from "react";
import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { addAdjustment, deleteAdjustment, finalizePayslip } from "../actions";
import { ADJUSTMENT_KINDS, formatDayMonth, formatMoney } from "@/lib/payroll";

export function AddAdjustmentForm({ employeeId, periodStart }: { employeeId: string; periodStart: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useFormAction(addAdjustment.bind(null, employeeId, periodStart), () => formRef.current?.reset());

  return (
    <ActionForm ref={formRef} action={action} className="card space-y-3 p-4">
      <h3 className="font-semibold">Thêm KPI / thưởng / phụ cấp / khoản trừ</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="adj-kind" className="mb-1 block text-xs font-medium text-neutral-600">Loại</label>
          <select id="adj-kind" name="kind" defaultValue="kpi" className="input">
            {ADJUSTMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.sign > 0 ? "＋ " : "－ "}{k.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="adj-amount" className="mb-1 block text-xs font-medium text-neutral-600">Số tiền (đ)</label>
          <input id="adj-amount" name="amount" inputMode="numeric" required placeholder="100000" className="input" />
          {state.fieldErrors?.amount && <p className="field-error">{state.fieldErrors.amount}</p>}
        </div>
      </div>
      <div>
        <label htmlFor="adj-reason" className="mb-1 block text-xs font-medium text-neutral-600">Lý do</label>
        <input id="adj-reason" name="reason" required maxLength={500} placeholder="Ví dụ: Đạt doanh số tháng 10" className="input" />
        {state.fieldErrors?.reason && <p className="field-error">{state.fieldErrors.reason}</p>}
      </div>
      {state.message && <p role="status" className={state.ok ? "alert-success" : "alert-error"}>{state.message}</p>}
      <div className="flex justify-end">
        <SubmitButton pending={pending} pendingText="Đang lưu...">Thêm khoản</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DeleteAdjustmentButton({ adjustmentId, label, amount }: { adjustmentId: string; label: string; amount: number }) {
  const [state, action, pending] = useFormAction(deleteAdjustment.bind(null, adjustmentId));
  return (
    <span className="mt-1 inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(`Xóa khoản "${label}" ${formatMoney(Math.abs(amount))}?`)) startTransition(() => action(new FormData()));
        }}
        className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
      >
        {pending ? "Đang xóa..." : "Xóa"}
      </button>
      {state.message && !state.ok && <span className="text-xs text-red-600">{state.message}</span>}
    </span>
  );
}

export function FinalizeButton({
  employeeId,
  periodStart,
  endDate = null,
  name,
  net,
}: {
  employeeId: string;
  periodStart: string;
  /** Có = chốt sớm đến ngày này */
  endDate?: string | null;
  name: string;
  net: number;
}) {
  const [state, action, pending] = useFormAction(finalizePayslip.bind(null, employeeId, periodStart, endDate));
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="card space-y-3 p-4">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="btn-primary w-full py-3">
          {endDate ? `Chốt lương sớm đến ${formatDayMonth(endDate)}` : "Chốt lương kỳ này"}
        </button>
      ) : (
        <>
          <p className="text-sm">
            Chốt lương <strong>{name}</strong>
            {endDate && <> sớm đến hết ngày <strong>{formatDayMonth(endDate)}</strong></>}: thực nhận{" "}
            <strong>{formatMoney(net)}</strong>. Sau khi chốt, phiếu lương bị khóa — sai sót sẽ phải truy thu/truy lĩnh ở kỳ sau.
            {endDate && " Công phát sinh sau ngày chốt trong kỳ này sẽ không được tính."}
          </p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setConfirming(false)} className="btn-secondary">Hủy</button>
            <button
              type="button"
              disabled={pending}
              onClick={() => startTransition(() => action(new FormData()))}
              className="btn-primary"
            >
              {pending ? "Đang chốt..." : "Xác nhận chốt"}
            </button>
          </div>
        </>
      )}
      {state.message && <p role="status" className={state.ok ? "alert-success" : "alert-error"}>{state.message}</p>}
    </div>
  );
}
