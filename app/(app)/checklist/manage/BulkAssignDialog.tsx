"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { bulkAssignTemplates } from "./actions";
import type { BranchStaff, TemplateItem } from "./TemplateDialog";

type Props = {
  selected: TemplateItem[];
  /** Mọi mẫu (để báo trước việc trùng tên) */
  allTemplates: TemplateItem[];
  branches: BranchStaff[];
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
};

export default function BulkAssignDialog({ selected, allTemplates, branches, open, onClose, onDone }: Props) {
  const [primary, setPrimary] = useState("");
  const [state, formAction, pending] = useFormAction(bulkAssignTemplates, (r) => onDone(r.message));
  const label = "mb-1.5 block text-sm font-medium text-neutral-700";

  // Nhân viên được giao phải làm ở chi nhánh của MỌI việc đã chọn
  const branchIds = [...new Set(selected.map((t) => t.branchId))];
  const staffLists = branchIds.map((id) => branches.find((b) => b.id === id)?.staff ?? []);
  const staff = (staffLists[0] ?? []).filter((s) => staffLists.every((list) => list.some((x) => x.id === s.id)));

  // Không giao trùng việc: 1 người (hoặc "theo ca") không có 2 mẫu đang áp dụng cùng tên trong cùng chi nhánh
  const key = (t: TemplateItem) => `${t.branchId}|${t.title.trim().replace(/\s+/g, " ").toLowerCase()}`;
  const duplicates = new Set<string>();
  if (primary) {
    const seen = new Set<string>();
    const selectedIds = new Set(selected.map((t) => t.id));
    const taken = new Set(
      allTemplates
        .filter((t) => t.isActive && !selectedIds.has(t.id) && (primary === "shift" ? t.assignByShift : t.primaryId === primary))
        .map(key)
    );
    for (const t of selected.filter((t) => t.isActive)) {
      if (seen.has(key(t)) || taken.has(key(t))) duplicates.add(t.title.trim());
      seen.add(key(t));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Giao việc hàng loạt" description={`${selected.length} công việc đã chọn`}>
      <ActionForm action={formAction} className="space-y-4">
        {selected.map((t) => <input key={t.id} type="hidden" name="template_ids" value={t.id} />)}

        <details className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-neutral-700">Xem danh sách ({selected.length})</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-neutral-600">
            {selected.map((t) => (
              <li key={t.id}>
                • {t.title} <span className="text-neutral-400">· {t.startTime}–{t.dueTime}{t.assignByShift ? " · theo ca" : t.primaryName ? ` · ${t.primaryName}` : ""}</span>
              </li>
            ))}
          </ul>
        </details>

        {branchIds.length > 1 && (
          <p className="text-xs text-neutral-500">
            Các việc thuộc {branchIds.length} chi nhánh — chỉ hiện nhân viên làm ở tất cả các chi nhánh này.
          </p>
        )}

        <div>
          <label htmlFor="ba-primary" className={label}>Người phụ trách chính</label>
          <select id="ba-primary" name="primary_employee_id" value={primary} onChange={(e) => setPrimary(e.target.value)} className="input">
            <option value="shift">🕒 Theo ca (ai có ca trùng giờ việc)</option>
            <option value="">— Bỏ giao (chuyển về chưa giao) —</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {staff.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">Không có nhân viên chung cho các chi nhánh đã chọn. Hãy lọc theo một chi nhánh.</p>
          )}
        </div>

        {primary === "shift" ? (
          <p className="text-xs text-neutral-500">
            Mỗi ngày, ai có ca (đã công bố) tại chi nhánh trùng giờ của việc sẽ nhận việc. Nhiều người cùng ca thì ai làm cũng được;
            bỏ sót thì cả ca bị tính &quot;không làm&quot;. Không có ai trong ca → báo Quản lý.
          </p>
        ) : primary ? (
          <div>
            <label htmlFor="ba-backup" className={label}>Người thay thế</label>
            <select id="ba-backup" name="backup" defaultValue="keep" className="input">
              <option value="keep">— Giữ nguyên như hiện tại —</option>
              <option value="">— Không có —</option>
              {staff.filter((s) => s.id !== primary).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {state.fieldErrors?.backup && <p className="field-error">{state.fieldErrors.backup}</p>}
          </div>
        ) : (
          <p className="alert-error">Bỏ giao sẽ hủy các việc chưa làm của những mẫu này từ hôm nay.</p>
        )}

        {duplicates.size > 0 && (
          <p role="alert" className="alert-error">
            {primary === "shift" ? "Đã có việc theo ca cùng tên" : `${staff.find((s) => s.id === primary)?.name} sẽ bị giao trùng việc`}: {[...duplicates].map((t) => `"${t}"`).join(", ")}.
            Hãy bỏ chọn bớt mẫu trùng tên hoặc chọn người khác.
          </p>
        )}
        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          <SubmitButton pending={pending} pendingText="Đang lưu...">{primary === "shift" ? `Giao ${selected.length} việc theo ca` : primary ? `Giao ${selected.length} việc` : "Bỏ giao"}</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
