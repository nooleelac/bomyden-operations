"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { saveProfile } from "../actions";
import { PAY_PERIOD_LABELS, PAY_TYPE_LABELS, formatMoney } from "@/lib/payroll";
import type { ActionState } from "@/lib/action-state";
import type { PayType, PayrollProfile, PayrollSettings } from "@/lib/database.types";

export type ProfileRow = {
  employeeId: string;
  name: string;
  roleLabel: string;
  profile: PayrollProfile | null;
};

function Money({ name, label, value, state, hint }: { name: string; label: string; value?: number | null; state: ActionState; hint?: string }) {
  return (
    <div>
      <label htmlFor={`pf-${name}`} className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      <input id={`pf-${name}`} name={name} inputMode="numeric" defaultValue={value ?? ""} placeholder={hint} className="input" />
      {state.fieldErrors?.[name] && <p className="field-error">{state.fieldErrors[name]}</p>}
    </div>
  );
}

export function describeProfile(p: PayrollProfile): string {
  const main =
    p.pay_type === "hourly"
      ? `${formatMoney(p.hourly_rate)}/giờ`
      : p.pay_type === "per_shift"
        ? `${formatMoney(p.shift_rate)}/ca`
        : `${formatMoney(p.fixed_salary)}/${p.pay_period === "weekly" ? "tuần" : "tháng"} (${p.standard_days} công)`;
  const extras = [
    p.overtime_enabled ? `tăng ca ${formatMoney(p.overtime_rate)}/giờ` : null,
    p.allowance_per_period ? `PC ${formatMoney(p.allowance_per_period)}/kỳ` : null,
    p.allowance_per_workday ? `PC ${formatMoney(p.allowance_per_workday)}/ngày` : null,
  ].filter(Boolean);
  return [`${PAY_TYPE_LABELS[p.pay_type]}: ${main}`, ...extras].join(" · ");
}

export default function ProfileDialog({
  row,
  settings,
  isAdmin,
  open,
  onClose,
  onDone,
}: {
  row: ProfileRow;
  settings: PayrollSettings;
  isAdmin: boolean;
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const p = row.profile;
  const [payType, setPayType] = useState<PayType>(p?.pay_type ?? "hourly");
  const [overtime, setOvertime] = useState(p?.overtime_enabled ?? false);
  const [state, action, pending] = useFormAction(saveProfile.bind(null, row.employeeId), (r) => onDone(r.message));

  return (
    <Dialog open={open} onClose={onClose} title={p ? "Sửa hồ sơ lương" : "Tạo hồ sơ lương"} description={row.name}>
      <ActionForm action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pf-type" className="mb-1 block text-xs font-medium text-neutral-600">Kiểu lương chính</label>
            <select id="pf-type" name="pay_type" value={payType} onChange={(e) => setPayType(e.target.value as PayType)} className="input">
              {(Object.keys(PAY_TYPE_LABELS) as PayType[]).map((t) => <option key={t} value={t}>{PAY_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pf-period" className="mb-1 block text-xs font-medium text-neutral-600">Kỳ lương</label>
            <select id="pf-period" name="pay_period" defaultValue={p?.pay_period ?? "monthly"} className="input">
              <option value="monthly">{PAY_PERIOD_LABELS.monthly}</option>
              <option value="weekly">{PAY_PERIOD_LABELS.weekly} (T2–CN)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {payType === "hourly" && <Money name="hourly_rate" label="Đơn giá / giờ" value={p?.hourly_rate} state={state} hint="25000" />}
          {payType === "per_shift" && <Money name="shift_rate" label="Đơn giá / ca" value={p?.shift_rate} state={state} hint="180000" />}
          {payType === "fixed" && (
            <>
              <Money name="fixed_salary" label="Lương cố định / kỳ" value={p?.fixed_salary} state={state} hint="7000000" />
              <div>
                <label htmlFor="pf-days" className="mb-1 block text-xs font-medium text-neutral-600">Ngày công chuẩn / kỳ</label>
                <input id="pf-days" name="standard_days" type="number" min={1} max={31} defaultValue={p?.standard_days ?? 26} className="input" />
              </div>
            </>
          )}
        </div>
        {/* Giữ giá trị các kiểu lương không hiển thị */}
        {payType !== "hourly" && <input type="hidden" name="hourly_rate" value={p?.hourly_rate ?? 0} />}
        {payType !== "per_shift" && <input type="hidden" name="shift_rate" value={p?.shift_rate ?? 0} />}
        {payType !== "fixed" && (
          <>
            <input type="hidden" name="fixed_salary" value={p?.fixed_salary ?? 0} />
            <input type="hidden" name="standard_days" value={p?.standard_days ?? 26} />
          </>
        )}

        <fieldset className="rounded-xl border border-neutral-200 p-3">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
            <input type="checkbox" name="overtime_enabled" checked={overtime} onChange={(e) => setOvertime(e.target.checked)} className="h-4 w-4 accent-neutral-900" />
            Tính tăng ca (giờ vượt chuẩn mỗi ngày)
          </label>
          {overtime ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pf-ot-h" className="mb-1 block text-xs font-medium text-neutral-600">Giờ chuẩn / ngày</label>
                <input id="pf-ot-h" name="overtime_threshold_hours" type="number" step="0.5" min={1} max={24} defaultValue={(p?.overtime_threshold_minutes ?? 480) / 60} className="input" />
              </div>
              <Money name="overtime_rate" label="Đơn giá tăng ca / giờ" value={p?.overtime_rate} state={state} hint="35000" />
            </div>
          ) : (
            <>
              <input type="hidden" name="overtime_threshold_hours" value={(p?.overtime_threshold_minutes ?? 480) / 60} />
              <input type="hidden" name="overtime_rate" value={p?.overtime_rate ?? 0} />
            </>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Money name="allowance_per_period" label="Phụ cấp cố định / kỳ" value={p?.allowance_per_period} state={state} hint="0" />
          <Money name="allowance_per_workday" label="Phụ cấp / ngày công" value={p?.allowance_per_workday} state={state} hint="0" />
        </div>

        <details className="rounded-xl border border-neutral-200 p-3">
          <summary className="cursor-pointer text-sm font-medium">Mức phạt riêng (bỏ trống = dùng mức chung)</summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pf-grace" className="mb-1 block text-xs font-medium text-neutral-600">Phút ân hạn (chung: {settings.late_grace_minutes})</label>
              <input id="pf-grace" name="late_grace_minutes" type="number" min={0} max={240} defaultValue={p?.late_grace_minutes ?? ""} className="input" />
            </div>
            <Money name="late_penalty" label={`Phạt trễ/lần (chung: ${formatMoney(settings.late_penalty)})`} value={p?.late_penalty} state={state} />
            <Money name="checklist_failed_penalty" label={`Phạt "Không đạt" (chung: ${formatMoney(settings.checklist_failed_penalty)})`} value={p?.checklist_failed_penalty} state={state} />
            <Money name="checklist_missed_penalty" label={`Phạt không làm (chung: ${formatMoney(settings.checklist_missed_penalty)})`} value={p?.checklist_missed_penalty} state={state} />
            <Money name="checklist_late_penalty" label={`Phạt làm trễ (chung: ${formatMoney(settings.checklist_late_penalty)})`} value={p?.checklist_late_penalty} state={state} />
          </div>
        </details>

        {isAdmin && (
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm">
            <input type="checkbox" name="can_view_payslip" defaultChecked={p?.can_view_payslip ?? false} className="mt-0.5 h-4 w-4 accent-neutral-900" />
            <span>
              <span className="block font-medium">Cho nhân viên xem phiếu lương</span>
              <span className="block text-xs text-neutral-500">Chỉ xem được các kỳ đã chốt.</span>
            </span>
          </label>
        )}

        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          <SubmitButton pending={pending} pendingText="Đang lưu...">Lưu hồ sơ</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
