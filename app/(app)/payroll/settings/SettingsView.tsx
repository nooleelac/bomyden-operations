"use client";

import { startTransition } from "react";
import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { saveSettings, setAutoCheckoutExempt, setManagerPayrollAccess } from "../actions";
import type { PayrollSettings } from "@/lib/database.types";

export function SettingsForm({ settings }: { settings: PayrollSettings }) {
  const [state, action, pending] = useFormAction(saveSettings);
  const fields = [
    { name: "late_penalty", label: "Phạt đi trễ (mỗi lần)", value: settings.late_penalty },
    { name: "early_leave_penalty", label: "Phạt về sớm không phép (mỗi lần)", value: settings.early_leave_penalty },
    { name: "absent_penalty", label: "Phạt nghỉ không phép (mỗi ca)", value: settings.absent_penalty },
    { name: "checklist_failed_penalty", label: 'Phạt checklist "Không đạt" (mỗi việc)', value: settings.checklist_failed_penalty },
    { name: "checklist_missed_penalty", label: "Phạt checklist không làm (mỗi việc)", value: settings.checklist_missed_penalty },
    { name: "checklist_late_penalty", label: "Phạt checklist làm trễ hạn (mỗi việc)", value: settings.checklist_late_penalty },
  ];

  return (
    <ActionForm action={action} className="card space-y-4 p-5">
      <h2 className="font-semibold">Mức phạt chung toàn quán</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="st-grace" className="mb-1 block text-sm font-medium text-neutral-700">Phút ân hạn đi trễ</label>
          <input id="st-grace" name="late_grace_minutes" type="number" min={0} max={240} defaultValue={settings.late_grace_minutes} className="input" />
          <p className="mt-1 text-xs text-neutral-500">Vào muộn hơn giờ bắt đầu ca theo lịch (không có lịch → giờ vào ca mặc định) quá số phút này mới tính là trễ.</p>
        </div>
        <div>
          <label htmlFor="st-egrace" className="mb-1 block text-sm font-medium text-neutral-700">Phút ân hạn về sớm</label>
          <input id="st-egrace" name="early_grace_minutes" type="number" min={0} max={240} defaultValue={settings.early_grace_minutes} className="input" />
          <p className="mt-1 text-xs text-neutral-500">Ra ca sớm hơn giờ kết thúc ca theo lịch quá số phút này mới tính là về sớm.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.name}>
            <label htmlFor={`st-${f.name}`} className="mb-1 block text-sm font-medium text-neutral-700">{f.label} (đ)</label>
            <input id={`st-${f.name}`} name={f.name} inputMode="numeric" defaultValue={f.value} className="input" />
            {state.fieldErrors?.[f.name] && <p className="field-error">{state.fieldErrors[f.name]}</p>}
          </div>
        ))}
      </div>
      <div className="border-t border-neutral-100 pt-4">
        <h2 className="font-semibold">Quên ra ca</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="st-cgrace" className="mb-1 block text-sm font-medium text-neutral-700">Phút du di sau hết ca</label>
            <input id="st-cgrace" name="checkout_grace_minutes" type="number" min={0} max={240} defaultValue={settings.checkout_grace_minutes} className="input" />
            {state.fieldErrors?.checkout_grace_minutes && <p className="field-error">{state.fieldErrors.checkout_grace_minutes}</p>}
          </div>
          <div>
            <label htmlFor="st-auto" className="mb-1 block text-sm font-medium text-neutral-700">Tự chốt sau hết ca (phút)</label>
            <input id="st-auto" name="auto_checkout_after_minutes" type="number" min={15} max={720} defaultValue={settings.auto_checkout_after_minutes} className="input" />
            {state.fieldErrors?.auto_checkout_after_minutes && <p className="field-error">{state.fieldErrors.auto_checkout_after_minutes}</p>}
          </div>
          <div>
            <label htmlFor="st-forgot" className="mb-1 block text-sm font-medium text-neutral-700">Phạt quên ra ca (mỗi lần) (đ)</label>
            <input id="st-forgot" name="forgot_checkout_penalty" inputMode="numeric" defaultValue={settings.forgot_checkout_penalty} className="input" />
            {state.fieldErrors?.forgot_checkout_penalty && <p className="field-error">{state.fieldErrors.forgot_checkout_penalty}</p>}
          </div>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Hết ca + phút du di mà chưa ra ca → nhắc nhân viên (bảng lương cảnh báo các lượt ra muộn hơn mốc này để kiểm tra).
          Hết ca + số phút tự chốt → app ghi giờ ra = giờ kết thúc ca và tính 1 lần quên ra ca. Nhân viên miễn tự chốt (cài ở dưới)
          chỉ được nhắc.
        </p>
      </div>
      <div className="border-t border-neutral-100 pt-4">
        <h2 className="font-semibold">Làm tròn giờ công theo ca</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="st-arnd" className="mb-1 block text-sm font-medium text-neutral-700">Đến sớm tối đa vẫn tính từ đầu ca (phút)</label>
            <input id="st-arnd" name="early_arrival_round_minutes" type="number" min={0} max={120} defaultValue={settings.early_arrival_round_minutes} className="input" />
            {state.fieldErrors?.early_arrival_round_minutes && <p className="field-error">{state.fieldErrors.early_arrival_round_minutes}</p>}
          </div>
          <div>
            <label htmlFor="st-lrnd" className="mb-1 block text-sm font-medium text-neutral-700">Ra sớm tối đa vẫn tính đủ ca (phút)</label>
            <input id="st-lrnd" name="early_checkout_round_minutes" type="number" min={0} max={60} defaultValue={settings.early_checkout_round_minutes} className="input" />
            {state.fieldErrors?.early_checkout_round_minutes && <p className="field-error">{state.fieldErrors.early_checkout_round_minutes}</p>}
          </div>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          VD ca 16:00–00:00 với 30 / 15 phút: vào 15:45, ra 23:45 → tính 16:00–00:00 (đủ 8 giờ, không phạt về sớm). Vào 15:50, ra 00:15
          → tính 16:00–00:15. Đến sớm hơn mốc → tính từ giờ vào thực tế (có thể thành tăng ca). Ra sớm hơn mốc → tính đến giờ ra thực tế.
          Ra sau giờ hết ca → tính theo giờ ra thực tế. Lượt không có ca theo lịch → tính giờ thực tế.
        </p>
      </div>
      <div className="border-t border-neutral-100 pt-4">
        <h2 className="font-semibold">Thưởng KPI checklist</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="st-kpi-bonus" className="mb-1 block text-sm font-medium text-neutral-700">Thưởng mỗi tuần đạt (đ)</label>
            <input id="st-kpi-bonus" name="kpi_checklist_bonus" inputMode="numeric" defaultValue={settings.kpi_checklist_bonus} className="input" />
            {state.fieldErrors?.kpi_checklist_bonus && <p className="field-error">{state.fieldErrors.kpi_checklist_bonus}</p>}
          </div>
          <div>
            <label htmlFor="st-kpi-target" className="mb-1 block text-sm font-medium text-neutral-700">Chỉ tiêu hoàn thành (%)</label>
            <input id="st-kpi-target" name="kpi_checklist_target_percent" type="number" min={1} max={100} defaultValue={settings.kpi_checklist_target_percent} className="input" />
            {state.fieldErrors?.kpi_checklist_target_percent && <p className="field-error">{state.fieldErrors.kpi_checklist_target_percent}</p>}
          </div>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Mỗi tuần (T2–CN) đã kết thúc, nếu số việc checklist <strong>xong đúng hạn</strong> đạt chỉ tiêu % trên tổng việc của nhân viên
          (việc tự đánh dấu + việc phụ trách mà bỏ không làm; việc trễ hạn / không đạt tính là chưa xong) thì phiếu lương tự cộng
          khoản thưởng. Kỳ tháng tính các tuần có Chủ nhật nằm trong tháng. Nhập 0 để tắt.
        </p>
      </div>
      <div className="border-t border-neutral-100 pt-4">
        <h2 className="font-semibold">Ứng lương</h2>
        <div className="mt-3 max-w-xs">
          <label htmlFor="st-advance" className="mb-1 block text-sm font-medium text-neutral-700">Được ứng tối đa (% lương tạm tính)</label>
          <input id="st-advance" name="advance_max_percent" type="number" min={0} max={100} defaultValue={settings.advance_max_percent} className="input" />
          {state.fieldErrors?.advance_max_percent && <p className="field-error">{state.fieldErrors.advance_max_percent}</p>}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Tính trên số thực nhận tạm tính của kỳ tới thời điểm xin ứng. Nhập 0 để tắt chức năng ứng lương.
        </p>
      </div>
      {state.message && <p role="status" className={state.ok ? "alert-success" : "alert-error"}>{state.message}</p>}
      <div className="flex justify-end">
        <SubmitButton pending={pending} pendingText="Đang lưu...">Lưu cài đặt</SubmitButton>
      </div>
    </ActionForm>
  );
}

const TOGGLES = {
  payroll: { action: setManagerPayrollAccess, label: "Quyền bảng lương" },
  exempt: { action: setAutoCheckoutExempt, label: "Miễn tự chốt ca" },
};

export function EmployeeToggle({
  employeeId,
  name,
  detail,
  enabled,
  kind,
}: {
  employeeId: string;
  name: string;
  detail?: string;
  enabled: boolean;
  kind: keyof typeof TOGGLES;
}) {
  const [state, action, pending] = useFormAction(TOGGLES[kind].action.bind(null, employeeId, !enabled));
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div>
        <p className="font-medium">{name}</p>
        {detail && <p className="text-xs text-neutral-500">{detail}</p>}
        {state.message && !state.ok && <p className="text-xs text-red-600">{state.message}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${TOGGLES[kind].label} của ${name}`}
        disabled={pending}
        onClick={() => startTransition(() => action(new FormData()))}
        className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${enabled ? "bg-emerald-600" : "bg-neutral-300"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-6" : "left-1"}`} />
      </button>
    </li>
  );
}
