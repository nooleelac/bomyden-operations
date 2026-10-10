"use client";

import { useRef, useState } from "react";
import { getCurrentSubscription } from "@/components/push";
import { removePushSubscription } from "@/app/(app)/notifications/actions";

/** Đăng xuất: gỡ thiết bị khỏi tài khoản trước để không nhận thông báo của người khác. */
export default function SignOutButton({ variant = "header" }: { variant?: "header" | "light" }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      ref={formRef}
      action="/auth/signout"
      method="post"
      onSubmit={async (event) => {
        if (pending) return;
        event.preventDefault();
        setPending(true);
        try {
          const subscription = await getCurrentSubscription();
          if (subscription) await removePushSubscription(subscription.endpoint);
        } catch {
          // Vẫn đăng xuất kể cả khi gỡ thiết bị lỗi
        }
        formRef.current?.submit();
      }}
    >
      <button
        type="submit"
        disabled={pending}
        className={
          variant === "light"
            ? "btn-secondary w-full text-red-700"
            : "rounded-lg border border-current/20 px-3 py-2 text-sm font-medium hover:bg-current/10 disabled:opacity-60"
        }
      >
        {pending ? "Đang thoát..." : "Đăng xuất"}
      </button>
    </form>
  );
}
