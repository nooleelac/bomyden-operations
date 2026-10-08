"use client";

import { useRef, useState } from "react";
import { getCurrentSubscription } from "@/components/push";
import { removePushSubscription } from "@/app/(app)/notifications/actions";

/** Đăng xuất: gỡ thiết bị khỏi tài khoản trước để không nhận thông báo của người khác. */
export default function SignOutButton() {
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
        className="rounded-lg border border-white/20 px-3 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-60"
      >
        {pending ? "Đang thoát..." : "Đăng xuất"}
      </button>
    </form>
  );
}
