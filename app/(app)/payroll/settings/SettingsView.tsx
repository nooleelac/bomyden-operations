"use client";

import { startTransition } from "react";
import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { saveSettings, setManagerPayrollAccess } from "../actions";
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

export function ManagerAccessToggle({ employeeId, name, enabled }: { employeeId: string; name: string; enabled: boolean }) {
  const [state, action, pending] = useFormAction(setManagerPayrollAccess.bind(null, employeeId, !enabled));
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div>
        <p className="font-medium">{name}</p>
        {state.message && !state.ok && <p className="text-xs text-red-600">{state.message}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Quyền bảng lương của ${name}`}
        disabled={pending}
        onClick={() => startTransition(() => action(new FormData()))}
        className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${enabled ? "bg-emerald-600" : "bg-neutral-300"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-6" : "left-1"}`} />
      </button>
    </li>
  );
}
