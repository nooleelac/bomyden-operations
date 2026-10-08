"use client";

import { useCallback, useEffect, useState } from "react";
import ProfileDialog, { describeProfile, type ProfileRow } from "./ProfileDialog";
import type { PayrollSettings } from "@/lib/database.types";

export default function ProfilesView({ rows, settings, isAdmin }: { rows: ProfileRow[]; settings: PayrollSettings; isAdmin: boolean }) {
  const [editing, setEditing] = useState<ProfileRow | null>(null);
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
      {rows.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-neutral-500">Không có nhân viên nào trong phạm vi của bạn.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.employeeId} className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {row.name}
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">{row.roleLabel}</span>
                  {row.profile?.can_view_payslip && (
                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">Xem phiếu lương</span>
                  )}
                </p>
                <p className="mt-0.5 text-neutral-500">
                  {row.profile ? describeProfile(row.profile) : <span className="text-amber-700">⚠ Chưa có hồ sơ lương</span>}
                </p>
              </div>
              <button type="button" onClick={() => setEditing(row)} className={row.profile ? "btn-secondary px-3 py-1.5" : "btn-primary px-3 py-1.5"}>
                {row.profile ? "Sửa" : "Tạo"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ProfileDialog
          key={editing.employeeId}
          row={editing}
          settings={settings}
          isAdmin={isAdmin}
          open
          onClose={() => setEditing(null)}
          onDone={done}
        />
      )}

      {toast && (
        <p role="status" className="alert-success fixed inset-x-4 bottom-4 z-50 shadow-lg sm:left-auto sm:right-6 sm:w-96">{toast}</p>
      )}
    </>
  );
}
