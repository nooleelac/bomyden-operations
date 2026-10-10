import { Suspense } from "react";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import PushSync from "@/components/PushSync";
import SignOutButton from "@/components/SignOutButton";
import RealtimeRefresh from "@/components/RealtimeRefresh";

// Mọi trang trong (app) phụ thuộc người đang đăng nhập → render theo từng request.
export const instant = false;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const employee = await requireEmployee();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 bg-neutral-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-xs font-black text-neutral-900">
              BMĐ
            </span>
            <span className="hidden text-base font-bold tracking-tight sm:inline">BÒ MỸ ĐEN</span>
          </Link>

          <div className="flex items-center gap-3">
            {/* Đếm thông báo chưa đọc tải song song, không chặn hiển thị trang */}
            <Suspense fallback={<NotificationBell unread={0} />}>
              <UnreadNotificationBell employeeId={employee.id} />
            </Suspense>
            <Link href="/account" className="text-right leading-tight hover:opacity-80">
              <span className="block max-w-[11rem] truncate text-sm font-semibold">
                {employee.full_name}
              </span>
              <span className="block text-xs text-neutral-400">{ROLE_LABELS[employee.role]}</span>
            </Link>

            <SignOutButton />
          </div>
        </div>
      </header>

      <PushSync employeeId={employee.id} />
      {/* Realtime: chuông thông báo tự cập nhật; mở lại app thì tải lại dữ liệu trang */}
      <RealtimeRefresh channel="bell" watch={[{ table: "notifications", filter: `employee_id=eq.${employee.id}` }]} refreshOnResume />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}

async function UnreadNotificationBell({ employeeId }: { employeeId: string }) {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", employeeId)
    .is("read_at", null);
  return <NotificationBell unread={count ?? 0} />;
}

function NotificationBell({ unread }: { unread: number }) {
  return (
    <Link
      href="/notifications"
      aria-label={unread ? `Thông báo (${unread} chưa đọc)` : "Thông báo"}
      className="relative rounded-lg p-2 hover:bg-white/10"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
      </svg>
      {unread ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
