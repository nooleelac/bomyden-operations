"use client";

import { useState, useTransition } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { createTaskSet, deleteTaskSet, moveTemplatesToSet, renameTaskSet } from "./actions";
import type { BranchStaff, TaskSetItem, TemplateItem } from "./TemplateDialog";

const label = "mb-1.5 block text-sm font-medium text-neutral-700";

/** Tạo bộ mới (kèm các mẫu đang chọn nếu có) hoặc đổi tên bộ */
function SetDialog({
  set,
  branches,
  templateIds = [],
  fixedBranchId,
  open,
  onClose,
  onDone,
}: {
  set?: TaskSetItem;
  branches: BranchStaff[];
  templateIds?: string[];
  fixedBranchId?: string;
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const action = set ? renameTaskSet.bind(null, set.id) : createTaskSet;
  const [state, formAction, pending] = useFormAction(action, (r) => onDone(r.message));
  const branchId = fixedBranchId ?? (branches.length === 1 ? branches[0].id : "");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={set ? "Đổi tên bộ việc" : "Tạo bộ việc"}
      description={templateIds.length > 0 ? `Đưa ${templateIds.length} công việc đã chọn vào bộ mới` : set?.branchName}
    >
      <ActionForm action={formAction} className="space-y-4">
        {templateIds.map((id) => <input key={id} type="hidden" name="template_ids" value={id} />)}
        {!set &&
          (fixedBranchId ? (
            <input type="hidden" name="branch_id" value={fixedBranchId} />
          ) : (
            <div>
              <label htmlFor="ts-branch" className={label}>Chi nhánh</label>
              <select id="ts-branch" name="branch_id" required defaultValue={branchId} className="input">
                <option value="">— Chọn chi nhánh —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              {state.fieldErrors?.branch_id && <p className="field-error">{state.fieldErrors.branch_id}</p>}
            </div>
          ))}
        <div>
          <label htmlFor="ts-name" className={label}>Tên bộ việc</label>
          <input id="ts-name" name="name" required maxLength={50} defaultValue={set?.name} placeholder="Ví dụ: Mở ca, Đóng ca, Bếp sáng" className="input" />
          {state.fieldErrors?.name && <p className="field-error">{state.fieldErrors.name}</p>}
        </div>
        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          <SubmitButton pending={pending} pendingText="Đang lưu...">{set ? "Lưu" : "Tạo bộ"}</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/** Khung "Bộ việc" phía trên danh sách mẫu */
export function TaskSetsPanel({
  sets,
  templates,
  branches,
  onSelect,
  onAssign,
  notify,
}: {
  sets: TaskSetItem[];
  templates: TemplateItem[];
  branches: BranchStaff[];
  /** Tick chọn mọi mẫu trong bộ */
  onSelect: (ids: string[]) => void;
  /** Chọn cả bộ rồi mở hộp thoại giao việc */
  onAssign: (ids: string[]) => void;
  notify: (message: string) => void;
}) {
  const [editing, setEditing] = useState<TaskSetItem | "new" | null>(null);
  const [pending, startTransition] = useTransition();
  const showBranch = new Set(sets.map((s) => s.branchId)).size > 1;
  const idsOf = (setId: string) => templates.filter((t) => t.setId === setId).map((t) => t.id);

  const remove = (set: TaskSetItem) => {
    if (!window.confirm(`Xóa bộ "${set.name}"?\nCác công việc trong bộ vẫn được giữ, chỉ gỡ khỏi bộ.`)) return;
    startTransition(async () => notify((await deleteTaskSet(set.id)).message));
  };

  return (
    <div className="card mb-4 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Bộ việc</h2>
        <button type="button" onClick={() => setEditing("new")} className="btn-secondary px-3 py-1.5 text-xs">+ Tạo bộ</button>
      </div>
      {sets.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Chưa có bộ nào. Gom các việc hay giao cùng nhau (VD &quot;Mở ca&quot;, &quot;Đóng ca&quot;) để giao cả bộ trong một lần.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {sets.map((s) => {
            const ids = idsOf(s.id);
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">📁 {s.name}</span>
                  <span className="text-neutral-500"> · {ids.length} việc{showBranch ? ` · ${s.branchName}` : ""}</span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => onSelect(ids)} disabled={ids.length === 0} className="btn-secondary px-2.5 py-1 text-xs">Chọn</button>
                  <button type="button" onClick={() => onAssign(ids)} disabled={ids.length === 0} className="btn-primary px-2.5 py-1 text-xs">Giao cả bộ</button>
                  <button type="button" onClick={() => setEditing(s)} className="btn-secondary px-2.5 py-1 text-xs">Đổi tên</button>
                  <button type="button" onClick={() => remove(s)} disabled={pending} className="btn-secondary px-2.5 py-1 text-xs text-red-700">Xóa</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <SetDialog
        key={editing === "new" ? "new" : editing?.id ?? "none"}
        set={editing && editing !== "new" ? editing : undefined}
        branches={branches}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onDone={(message) => {
          setEditing(null);
          notify(message);
        }}
      />
    </div>
  );
}

/** "Đưa vào bộ" cho các mẫu đang chọn: chọn bộ có sẵn, tạo bộ mới, hoặc gỡ khỏi bộ */
export function MoveToSetDialog({
  selected,
  sets,
  branches,
  open,
  onClose,
  onDone,
}: {
  selected: TemplateItem[];
  sets: TaskSetItem[];
  branches: BranchStaff[];
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const branchIds = [...new Set(selected.map((t) => t.branchId))];
  const branchId = branchIds.length === 1 ? branchIds[0] : null;
  const branchSets = sets.filter((s) => s.branchId === branchId);
  const ids = selected.map((t) => t.id);

  const move = (setId: string | null) =>
    startTransition(async () => {
      const result = await moveTemplatesToSet(ids, setId);
      if (result.ok) onDone(result.message);
      else setError(result.message);
    });

  if (creating && branchId) {
    return (
      <SetDialog branches={branches} templateIds={ids} fixedBranchId={branchId} open={open} onClose={onClose} onDone={onDone} />
    );
  }

  return (
    <Dialog open={open} onClose={onClose} title="Đưa vào bộ việc" description={`${selected.length} công việc đã chọn`}>
      <div className="space-y-3">
        {!branchId ? (
          <p className="alert-error">Các việc đã chọn thuộc nhiều chi nhánh. Bộ việc chỉ gồm việc của 1 chi nhánh — hãy lọc theo chi nhánh rồi chọn lại.</p>
        ) : (
          <>
            {branchSets.length > 0 && (
              <ul className="space-y-2">
                {branchSets.map((s) => (
                  <li key={s.id}>
                    <button type="button" disabled={pending} onClick={() => move(s.id)} className="btn-secondary w-full justify-start text-left">
                      📁 {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" disabled={pending} onClick={() => setCreating(true)} className="btn-primary w-full">+ Tạo bộ mới với các việc này</button>
            {selected.some((t) => t.setId) && (
              <button type="button" disabled={pending} onClick={() => move(null)} className="btn-secondary w-full text-red-700">Gỡ khỏi bộ</button>
            )}
          </>
        )}
        {error && <p role="alert" className="alert-error">{error}</p>}
        <div className="flex justify-end border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Đóng</button>
        </div>
      </div>
    </Dialog>
  );
}
