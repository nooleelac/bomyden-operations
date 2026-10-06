"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import EmployeeFormFields from "./EmployeeFormFields";
import { resetEmployeePassword, setEmployeeActive, updateEmployee } from "./actions";
import type { ActionState } from "@/lib/action-state";
import { formatPhone } from "@/lib/phone";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/employee";
import type { EmployeeRole } from "@/lib/database.types";
import type { EmployeeListItem } from "./EmployeesView";

type Props = {
  employee: EmployeeListItem;
  roles: EmployeeRole[];
  isSelf: boolean;
  onDone: (message: string) => void;
};

type Panel = "edit" | "password" | "toggle" | null;

export default function EmployeeRowActions({ employee, roles, isSelf, onDone }: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const close = () => setPanel(null);
  const finish = (message: string) => {
    close();
    onDone(message);
  };

  const onSuccess = (result: ActionState) => finish(result.message);

  const [editState, editAction, editPending] = useFormAction(
    updateEmployee.bind(null, employee.id),
    onSuccess
  );
  const [passwordState, passwordAction, passwordPending] = useFormAction(
    resetEmployeePassword.bind(null, employee.id),
    onSuccess
  );
  const [toggleState, toggleAction, togglePending] = useFormAction(
    setEmployeeActive.bind(null, employee.id, !employee.is_active),
    onSuccess
  );

  // Không cho tự đổi chức vụ; chức vụ hiện tại có thể nằm ngoài danh sách được gán (vd: Quản trị viên)
  const roleLocked = isSelf || !roles.includes(employee.role);

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setPanel("edit")} className="btn-secondary px-3 py-1.5">
        Sửa
      </button>
      <button type="button" onClick={() => setPanel("password")} className="btn-secondary px-3 py-1.5">
        Đặt lại mật khẩu
      </button>
      {!isSelf && (
        <button
          type="button"
          onClick={() => setPanel("toggle")}
          className={`btn px-3 py-1.5 ${
            employee.is_active
              ? "border border-red-200 bg-white text-red-700 hover:bg-red-50"
              : "border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
          }`}
        >
          {employee.is_active ? "Khóa" : "Mở khóa"}
        </button>
      )}

      {/* SỬA */}
      <Dialog open={panel === "edit"} onClose={close} title="Sửa thông tin nhân viên" description={employee.full_name}>
        <ActionForm action={editAction} className="space-y-5">
          <EmployeeFormFields
            idPrefix={`edit-${employee.id}`}
            roles={roles}
            roleLocked={roleLocked}
            fieldErrors={editState.ok ? undefined : editState.fieldErrors}
            defaults={{
              full_name: employee.full_name,
              email: employee.email ?? "",
              phone: employee.phone ? formatPhone(employee.phone).replace(/\s/g, "") : "",
              role: employee.role,
              default_start_time: employee.default_start_time?.slice(0, 5) ?? "",
              sort_order: employee.sort_order,
            }}
          />
          {editState.message && !editState.ok && (
            <p role="alert" className="alert-error">{editState.message}</p>
          )}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={close} className="btn-secondary">Hủy</button>
            <SubmitButton pending={editPending} pendingText="Đang lưu...">Lưu thay đổi</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>

      {/* ĐẶT LẠI MẬT KHẨU */}
      <Dialog
        open={panel === "password"}
        onClose={close}
        title="Đặt lại mật khẩu"
        description={`Đặt mật khẩu mới cho ${employee.full_name}, sau đó báo trực tiếp cho nhân viên.`}
      >
        <ActionForm action={passwordAction} className="space-y-4">
          {(["password", "confirm_password"] as const).map((name) => (
            <div key={name}>
              <label htmlFor={`${name}-${employee.id}`} className="mb-1.5 block text-sm font-medium text-neutral-700">
                {name === "password" ? "Mật khẩu mới" : "Nhập lại mật khẩu mới"}
              </label>
              <input
                id={`${name}-${employee.id}`}
                name={name}
                type="password"
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                required
                className="input"
              />
              {passwordState.fieldErrors?.[name] && (
                <p className="field-error">{passwordState.fieldErrors[name]}</p>
              )}
            </div>
          ))}
          {passwordState.message && !passwordState.ok && (
            <p role="alert" className="alert-error">{passwordState.message}</p>
          )}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={close} className="btn-secondary">Hủy</button>
            <SubmitButton pending={passwordPending} pendingText="Đang lưu...">Đặt lại mật khẩu</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>

      {/* KHÓA / MỞ KHÓA */}
      <Dialog
        open={panel === "toggle"}
        onClose={close}
        title={employee.is_active ? "Khóa tài khoản?" : "Mở khóa tài khoản?"}
      >
        <ActionForm action={toggleAction} className="space-y-4">
          <p className="text-sm text-neutral-600">
            {employee.is_active ? (
              <>
                <strong>{employee.full_name}</strong> sẽ không thể đăng nhập nữa. Toàn bộ lịch sử làm việc
                vẫn được giữ nguyên. Bạn có thể mở khóa lại bất cứ lúc nào.
              </>
            ) : (
              <>
                <strong>{employee.full_name}</strong> sẽ đăng nhập lại được bằng mật khẩu cũ.
              </>
            )}
          </p>
          {toggleState.message && !toggleState.ok && (
            <p role="alert" className="alert-error">{toggleState.message}</p>
          )}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={close} className="btn-secondary">Hủy</button>
            <SubmitButton
              pending={togglePending}
              variant={employee.is_active ? "danger" : "primary"}
            >
              {employee.is_active ? "Khóa tài khoản" : "Mở khóa"}
            </SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </div>
  );
}
