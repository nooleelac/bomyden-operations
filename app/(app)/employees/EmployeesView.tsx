"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CreateEmployeeButton from "./CreateEmployeeButton";
import EmployeeRowActions from "./EmployeeRowActions";
import { ROLE_LABELS, canManageTarget } from "@/lib/auth/roles";
import { formatPhone } from "@/lib/phone";
import type { Employee, EmployeeRole } from "@/lib/database.types";

export type EmployeeListItem = Pick<
  Employee,
  | "id"
  | "full_name"
  | "email"
  | "phone"
  | "role"
  | "is_active"
  | "default_start_time"
  | "sort_order"
  | "deactivated_at"
>;

type Props = {
  employees: EmployeeListItem[];
  actorId: string;
  actorRole: EmployeeRole;
  assignable: EmployeeRole[];
  showLocked: boolean;
};

export default function EmployeesView({ employees, actorId, actorRole, assignable, showLocked }: Props) {
  const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-1 text-sm">
          <Link
            href="/employees"
            className={`rounded-md px-3 py-1.5 font-medium ${!showLocked ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
          >
            Đang làm
          </Link>
          <Link
            href="/employees?status=locked"
            className={`rounded-md px-3 py-1.5 font-medium ${showLocked ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
          >
            Đã khóa
          </Link>
        </div>
        <CreateEmployeeButton roles={assignable} onDone={notify} />
      </div>

      {employees.length === 0 ? (
        <div className="card mt-4 px-6 py-14 text-center text-neutral-500">
          {showLocked ? "Không có tài khoản nào bị khóa." : "Chưa có nhân viên. Bấm “Thêm nhân viên” để bắt đầu."}
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {employees.map((employee) => {
            const manageable = canManageTarget(actorRole, employee.role);
            return (
              <li key={employee.id} className="card p-4 sm:p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{employee.full_name}</span>
                      <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
                        {ROLE_LABELS[employee.role]}
                      </span>
                      {employee.id === actorId && (
                        <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">Bạn</span>
                      )}
                      {!employee.is_active && (
                        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">Đã khóa</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-500">
                      {employee.phone && <span>📞 {formatPhone(employee.phone)}</span>}
                      {employee.email && <span className="truncate">✉️ {employee.email}</span>}
                      {employee.default_start_time && <span>🕐 Vào ca {employee.default_start_time.slice(0, 5)}</span>}
                    </div>
                  </div>

                  {manageable ? (
                    <EmployeeRowActions
                      employee={employee}
                      roles={assignable}
                      isSelf={employee.id === actorId}
                      onDone={notify}
                    />
                  ) : (
                    <span className="text-xs text-neutral-400">Chỉ Quản trị viên được thay đổi</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {toast && (
        <p
          role="status"
          className="alert-success fixed inset-x-4 bottom-4 z-50 shadow-lg sm:left-auto sm:right-6 sm:w-96"
        >
          {toast}
        </p>
      )}
    </>
  );
}
