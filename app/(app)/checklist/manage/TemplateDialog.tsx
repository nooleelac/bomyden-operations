"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { createTemplate, updateTemplate } from "./actions";
import { PRIORITIES, PRIORITY_LABELS, TASK_CATEGORIES, WEEKDAY_LABELS } from "@/lib/checklist";
import type { ActionState } from "@/lib/action-state";
import type { TaskFrequency, TaskPriority } from "@/lib/database.types";

export type BranchStaff = { id: string; name: string; staff: { id: string; name: string }[] };

export type TaskSetItem = { id: string; branchId: string; branchName: string; name: string };

export type TemplateItem = {
  id: string;
  branchId: string;
  branchName: string;
  title: string;
  description: string | null;
  category: string;
  priority: TaskPriority;
  startTime: string;
  dueTime: string;
  frequency: TaskFrequency;
  weekdays: number[];
  monthDays: number[];
  requiresPhoto: boolean;
  requiresNote: boolean;
  /** Giao theo ca (ai có ca trùng giờ việc thì nhận) */
  assignByShift: boolean;
  /** Bộ việc (nhóm mẫu) */
  setId: string | null;
  primaryId: string | null;
  primaryName: string | null;
  backupId: string | null;
  backupName: string | null;
  isActive: boolean;
  sortOrder: number;
};

type Props = {
  template?: TemplateItem;
  /** Tạo mẫu mới dựa trên nội dung mẫu có sẵn (sao chép) */
  copyFrom?: TemplateItem;
  branches: BranchStaff[];
  sets: TaskSetItem[];
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  /** Chỉ khi sửa: xóa mẫu này */
  onDelete?: () => void;
  deleting?: boolean;
};

function Err({ state, name }: { state: ActionState; name: string }) {
  return state.fieldErrors?.[name] ? <p className="field-error">{state.fieldErrors[name]}</p> : null;
}

export default function TemplateDialog({ template, copyFrom, branches, sets, open, onClose, onDone, onDelete, deleting }: Props) {
  // Giá trị ban đầu của các ô: từ mẫu đang sửa, hoặc mẫu được sao chép
  const init = template ?? (copyFrom && { ...copyFrom, title: `${copyFrom.title} (bản sao)` });
  const [branchId, setBranchId] = useState(init?.branchId ?? (branches.length === 1 ? branches[0].id : ""));
  const [frequency, setFrequency] = useState<TaskFrequency>(init?.frequency ?? "daily");
  const [assignMode, setAssignMode] = useState<"person" | "shift">(init?.assignByShift ? "shift" : "person");
  const action = template ? updateTemplate.bind(null, template.id) : createTemplate;
  const [state, formAction, pending] = useFormAction(action, (r) => onDone(r.message));
  const staff = branches.find((b) => b.id === branchId)?.staff ?? [];
  const branchSets = sets.filter((s) => s.branchId === branchId);
  const label = "mb-1.5 block text-sm font-medium text-neutral-700";

  return (
    <Dialog open={open} onClose={onClose} title={template ? "Sửa công việc" : copyFrom ? "Sao chép công việc" : "Tạo công việc"} description={template?.branchName}>
      <ActionForm action={formAction} className="space-y-4">
        {!template && (
          <div>
            <label htmlFor="tp-branch" className={label}>Chi nhánh <span className="text-red-600">*</span></label>
            <select id="tp-branch" name="branch_id" required value={branchId} onChange={(e) => setBranchId(e.target.value)} className="input">
              <option value="">— Chọn chi nhánh —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <Err state={state} name="branch_id" />
          </div>
        )}

        <div>
          <label htmlFor="tp-title" className={label}>Tên công việc <span className="text-red-600">*</span></label>
          <input id="tp-title" name="title" required maxLength={150} defaultValue={init?.title} placeholder="Ví dụ: Kiểm kê thịt bò Mỹ" className="input" />
          <Err state={state} name="title" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tp-cat" className={label}>Nhóm</label>
            <select id="tp-cat" name="category" defaultValue={init?.category ?? TASK_CATEGORIES[0]} className="input">
              {TASK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tp-pri" className={label}>Mức độ</label>
            <select id="tp-pri" name="priority" defaultValue={init?.priority ?? "normal"} className="input">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p].label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="tp-start" className={label}>Bắt đầu</label>
            <input id="tp-start" name="start_time" type="time" required defaultValue={init?.startTime ?? "10:00"} className="input" />
            <Err state={state} name="start_time" />
          </div>
          <div>
            <label htmlFor="tp-due" className={label}>Hạn chót</label>
            <input id="tp-due" name="due_time" type="time" required defaultValue={init?.dueTime ?? "11:00"} className="input" />
            <Err state={state} name="due_time" />
          </div>
        </div>

        <fieldset>
          <legend className={label}>Lặp lại</legend>
          <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-sm">
            {(["daily", "weekly", "monthly"] as const).map((f) => (
              <label key={f} className={`cursor-pointer rounded-md px-3 py-1.5 font-medium ${frequency === f ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>
                <input type="radio" name="frequency" value={f} checked={frequency === f} onChange={() => setFrequency(f)} className="sr-only" />
                {f === "daily" ? "Hằng ngày" : f === "weekly" ? "Theo thứ" : "Theo ngày tháng"}
              </label>
            ))}
          </div>
          {frequency === "weekly" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <label key={d} className="flex cursor-pointer items-center rounded-lg border border-neutral-300 px-3 py-2 text-sm has-[:checked]:border-neutral-900 has-[:checked]:bg-neutral-900 has-[:checked]:text-white">
                  <input type="checkbox" name="weekdays" value={d} defaultChecked={init?.weekdays.includes(d)} className="sr-only" />
                  {WEEKDAY_LABELS[d]}
                </label>
              ))}
            </div>
          )}
          {frequency === "monthly" && (
            <div className="mt-3">
              <input name="month_days" defaultValue={init?.monthDays.join(", ")} placeholder="Ví dụ: 1, 15, 31" className="input" />
              <p className="mt-1 text-xs text-neutral-500">Ngày không có trong tháng (29–31) sẽ chạy vào ngày cuối tháng.</p>
            </div>
          )}
          {frequency !== "monthly" && <input type="hidden" name="month_days" value="" />}
          <Err state={state} name="weekdays" />
          <Err state={state} name="month_days" />
        </fieldset>

        <fieldset>
          <legend className={label}>Giao cho</legend>
          <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-sm">
            {(["person", "shift"] as const).map((m) => (
              <label key={m} className={`cursor-pointer rounded-md px-3 py-1.5 font-medium ${assignMode === m ? "bg-neutral-900 text-white" : "text-neutral-600"}`}>
                <input type="radio" name="assign_mode" value={m} checked={assignMode === m} onChange={() => setAssignMode(m)} className="sr-only" />
                {m === "person" ? "Người cụ thể" : "🕒 Theo ca"}
              </label>
            ))}
          </div>
          {assignMode === "shift" && (
            <p className="mt-2 text-xs text-neutral-500">
              Mỗi ngày, ai có ca (đã công bố) tại chi nhánh trùng giờ của việc sẽ nhận việc. Nhiều người cùng ca thì ai làm cũng được;
              bỏ sót thì cả ca bị tính &quot;không làm&quot;. Không có ai trong ca → báo Quản lý.
            </p>
          )}
        </fieldset>

        <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${assignMode === "shift" ? "hidden" : ""}`}>
          <div>
            <label htmlFor="tp-primary" className={label}>Người phụ trách chính</label>
            <select key={`p-${branchId}`} id="tp-primary" name="primary_employee_id" defaultValue={init?.primaryId ?? ""} className="input">
              <option value="">— Chưa giao —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-neutral-500">Để trống nếu muốn giao hàng loạt sau. Mẫu chưa giao sẽ không sinh việc.</p>
            <Err state={state} name="primary_employee_id" />
          </div>
          <div>
            <label htmlFor="tp-backup" className={label}>Người thay thế</label>
            <select key={`b-${branchId}`} id="tp-backup" name="backup_employee_id" defaultValue={init?.backupId ?? ""} className="input">
              <option value="">— Không có —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="mt-1 text-xs text-neutral-500">Chỉ làm thay khi người chính không chấm công hôm đó.</p>
            <Err state={state} name="backup_employee_id" />
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" name="requires_photo" defaultChecked={init?.requiresPhoto} className="h-4 w-4 accent-neutral-900" />
            Bắt buộc chụp ảnh khi hoàn thành
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" name="requires_note" defaultChecked={init?.requiresNote} className="h-4 w-4 accent-neutral-900" />
            Bắt buộc ghi chú khi hoàn thành
          </label>
          <p className="text-xs text-neutral-500">Báo &quot;Không đạt&quot; luôn phải ghi lý do.</p>
        </div>

        <div>
          <label htmlFor="tp-set" className={label}>Bộ việc</label>
          <select key={`s-${branchId}`} id="tp-set" name="set_id" defaultValue={init?.setId ?? ""} className="input">
            <option value="">— Không thuộc bộ nào —</option>
            {branchSets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-neutral-500">Gom các việc hay giao cùng nhau (VD &quot;Mở ca&quot;) để giao cả bộ một lần.</p>
          <Err state={state} name="set_id" />
        </div>

        <div>
          <label htmlFor="tp-desc" className={label}>Hướng dẫn</label>
          <textarea id="tp-desc" name="description" rows={3} maxLength={1000} defaultValue={init?.description ?? ""} placeholder="Ví dụ: Thịt phải đủ bán đến 14h hôm sau." className="input" />
        </div>

        <div className="grid grid-cols-2 items-end gap-3">
          <div>
            <label htmlFor="tp-sort" className={label}>Thứ tự</label>
            <input id="tp-sort" name="sort_order" type="number" min={0} max={9999} defaultValue={init?.sortOrder ?? 0} className="input" />
          </div>
          {template && (
            <label className="flex h-[42px] cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 px-3 text-sm">
              <input type="checkbox" name="is_active" defaultChecked={template.isActive} className="h-4 w-4 accent-neutral-900" />
              Đang áp dụng
            </label>
          )}
        </div>

        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          {template && onDelete && (
            <button type="button" onClick={onDelete} disabled={deleting || pending} className="btn-danger mr-auto">
              {deleting ? "Đang xóa..." : "Xóa"}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          <SubmitButton pending={pending} pendingText="Đang lưu...">{template ? "Lưu thay đổi" : "Tạo công việc"}</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
