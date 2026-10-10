"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import BranchFormFields, { type BranchFormDefaults } from "./BranchFormFields";
import { createBranch, deleteBranch, updateBranch } from "./actions";
import type { ActionState } from "@/lib/action-state";

export type BranchItem = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  wifi_ips: string[];
  is_active: boolean;
  employee_count: number;
};

function toDefaults(branch?: BranchItem): BranchFormDefaults {
  return {
    name: branch?.name ?? "",
    address: branch?.address ?? "",
    latitude: branch?.latitude?.toString() ?? "",
    longitude: branch?.longitude?.toString() ?? "",
    radius_m: branch?.radius_m ?? 100,
    wifi_ips: branch?.wifi_ips.join("\n") ?? "",
    is_active: branch?.is_active ?? true,
  };
}

function BranchDialog({
  branch,
  open,
  onClose,
  onDone,
  currentIp,
}: {
  branch?: BranchItem;
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  currentIp: string | null;
}) {
  const [formKey, setFormKey] = useState(0);
  const action = branch ? updateBranch.bind(null, branch.id) : createBranch;
  const [state, formAction, pending] = useFormAction(action, (result: ActionState) => {
    setFormKey((key) => key + 1);
    onDone(result.message);
  });
  const [deleting, startDeleting] = useTransition();
  const [deleteError, setDeleteError] = useState("");
  const remove = () => {
    if (!branch) return;
    if (!window.confirm(`Xóa chi nhánh "${branch.name}"?

Chỉ xóa được khi chi nhánh chưa có chấm công, lịch làm, kho hay checklist đã làm. Nhân viên được gán sẽ được gỡ khỏi chi nhánh này.`)) return;
    setDeleteError("");
    startDeleting(async () => {
      const result = await deleteBranch(branch.id, branch.name);
      if (result.ok) onDone(result.message);
      else setDeleteError(result.message);
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={branch ? "Sửa chi nhánh" : "Thêm chi nhánh"}
      description={branch?.name}
    >
      <ActionForm key={formKey} action={formAction} className="space-y-5">
        <BranchFormFields
          idPrefix={branch ? `edit-${branch.id}` : "create"}
          defaults={toDefaults(branch)}
          fieldErrors={state.ok ? undefined : state.fieldErrors}
          currentIp={currentIp}
          showActive={Boolean(branch)}
        />
        {deleteError && <p role="alert" className="alert-error">{deleteError}</p>}
        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          {branch && (
            <button type="button" onClick={remove} disabled={deleting || pending} className="btn mr-auto px-3 text-red-700 hover:bg-red-50">
              {deleting ? "Đang xóa..." : "🗑 Xóa"}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          <SubmitButton pending={pending} pendingText="Đang lưu...">
            {branch ? "Lưu thay đổi" : "Tạo chi nhánh"}
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export default function BranchesView({ branches, currentIp }: { branches: BranchItem[]; currentIp: string | null }) {
  const [editing, setEditing] = useState<BranchItem | "new" | null>(null);
  const [toast, setToast] = useState("");

  const done = useCallback((message: string) => {
    setEditing(null);
    setToast(message);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing("new")} className="btn-primary">
          + Thêm chi nhánh
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="card mt-4 px-6 py-14 text-center text-neutral-500">
          Chưa có chi nhánh. Bấm “Thêm chi nhánh” để bắt đầu.
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {branches.map((branch) => {
            const hasGps = branch.latitude !== null;
            const hasWifi = branch.wifi_ips.length > 0;
            return (
              <li key={branch.id} className="card p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{branch.name}</span>
                      {!branch.is_active && (
                        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
                          Ngừng hoạt động
                        </span>
                      )}
                    </div>
                    {branch.address && <p className="mt-0.5 text-sm text-neutral-500">{branch.address}</p>}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className={`rounded-full px-2.5 py-1 ${hasGps ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                        {hasGps ? `📍 GPS · bán kính ${branch.radius_m} m` : "📍 Chưa có GPS"}
                      </span>
                      <span className={`rounded-full px-2.5 py-1 ${hasWifi ? "bg-emerald-50 text-emerald-800" : "bg-neutral-100 text-neutral-600"}`}>
                        {hasWifi ? `📶 ${branch.wifi_ips.length} IP Wi-Fi` : "📶 Chưa có Wi-Fi"}
                      </span>
                      <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-700" title="Số nhân viên đang làm được gán vào chi nhánh này (trang Nhân viên)">
                        👥 {branch.employee_count} nhân viên
                      </span>
                    </div>
                    {!hasGps && !hasWifi && (
                      <p className="mt-2 text-xs text-amber-700">
                        Chưa cài GPS hoặc Wi-Fi nên nhân viên chưa chấm công được ở chi nhánh này.
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => setEditing(branch)} className="btn-secondary px-3 py-1.5">
                    Sửa
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <BranchDialog
        key={editing === "new" ? "new" : editing?.id ?? "none"}
        branch={editing && editing !== "new" ? editing : undefined}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onDone={done}
        currentIp={currentIp}
      />

      {toast && (
        <p role="status" className="alert-success fixed inset-x-4 bottom-[calc(var(--nav-h)+1rem)] z-50 shadow-lg sm:left-auto sm:right-6 sm:w-96">
          {toast}
        </p>
      )}
    </>
  );
}
