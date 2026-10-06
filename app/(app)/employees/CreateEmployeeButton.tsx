"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import EmployeeFormFields from "./EmployeeFormFields";
import { createEmployee } from "./actions";
import type { EmployeeRole } from "@/lib/database.types";

export default function CreateEmployeeButton({
  roles,
  onDone,
}: {
  roles: EmployeeRole[];
  onDone?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  // Thành công → đóng hộp thoại, làm mới form, báo kết quả
  const [state, formAction, pending] = useFormAction(createEmployee, (result) => {
    setOpen(false);
    setFormKey((key) => key + 1);
    onDone?.(result.message);
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary">
        + Thêm nhân viên
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Thêm nhân viên"
        description="Tạo hồ sơ nhân viên và tài khoản đăng nhập."
      >
        <ActionForm key={formKey} action={formAction} className="space-y-5">
          <EmployeeFormFields
            idPrefix="create"
            withPassword
            roles={roles}
            fieldErrors={state.ok ? undefined : state.fieldErrors}
            defaults={{
              full_name: "",
              email: "",
              phone: "",
              role: "staff",
              default_start_time: "",
              sort_order: 0,
            }}
          />

          {state.message && !state.ok && (
            <p role="alert" className="alert-error">
              {state.message}
            </p>
          )}

          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
              Hủy
            </button>
            <SubmitButton pending={pending} pendingText="Đang tạo...">
              Tạo nhân viên
            </SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}
