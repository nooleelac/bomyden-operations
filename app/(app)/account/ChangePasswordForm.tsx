"use client";

import { useActionState, useEffect, useRef } from "react";
import { changeOwnPassword } from "./actions";
import { initialActionState } from "@/lib/action-state";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/employee";
import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";

export default function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changeOwnPassword, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.successKey) formRef.current?.reset();
  }, [state.successKey]);

  const fields = [
    { name: "current_password", label: "Mật khẩu hiện tại", autoComplete: "current-password" },
    { name: "password", label: "Mật khẩu mới", autoComplete: "new-password" },
    { name: "confirm_password", label: "Nhập lại mật khẩu mới", autoComplete: "new-password" },
  ];

  return (
    <ActionForm ref={formRef} action={formAction} className="space-y-4">
      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name} className="mb-1.5 block text-sm font-medium text-neutral-700">
            {field.label}
          </label>
          <input
            id={field.name}
            name={field.name}
            type="password"
            autoComplete={field.autoComplete}
            minLength={field.name === "current_password" ? undefined : PASSWORD_MIN_LENGTH}
            required
            className="input"
          />
          {state.fieldErrors?.[field.name] && (
            <p className="field-error">{state.fieldErrors[field.name]}</p>
          )}
        </div>
      ))}

      {state.message && (
        <p role="status" className={state.ok ? "alert-success" : "alert-error"}>
          {state.message}
        </p>
      )}

      <SubmitButton pending={pending} pendingText="Đang lưu...">
        Đổi mật khẩu
      </SubmitButton>
    </ActionForm>
  );
}
