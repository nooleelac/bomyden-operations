"use client";

import { useActionState } from "react";
import { signIn } from "./actions";
import { initialActionState } from "@/lib/action-state";
import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialActionState);

  return (
    <ActionForm action={formAction} className="space-y-5">
      <input type="hidden" name="next" value={next} />

      <div>
        <label htmlFor="identifier" className="mb-1.5 block text-sm font-medium text-neutral-700">
          Email hoặc số điện thoại
        </label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="ví dụ: 0901234567"
          className="input"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-neutral-700">
          Mật khẩu
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </div>

      {state.message && !state.ok && (
        <p role="alert" className="alert-error">
          {state.message}
        </p>
      )}

      <SubmitButton pending={pending} pendingText="Đang đăng nhập..." className="w-full py-3">
        Đăng nhập
      </SubmitButton>
    </ActionForm>
  );
}
