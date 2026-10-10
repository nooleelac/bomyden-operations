import { Suspense } from "react";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { getBranding } from "@/lib/branding";
import { getModules, pickNavModules } from "@/lib/modules";
import PushSync from "@/components/PushSync";
import SignOutButton from "@/components/SignOutButton";
import LiveSync from "@/components/LiveSync";
import NetworkStatus from "@/components/NetworkStatus";
import BrandMark from "@/components/BrandMark";
import BottomNav, { Avatar } from "@/components/BottomNav";

// Mọi trang trong (app) phụ thuộc người đang đăng nhập → render theo từng request.
export const instant = false;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const employee = await requireEmployee();
  const [branding, modules] = await Promise.all([getBranding(), getModules(employee)]);
  const roleLabel = ROLE_LABELS[employee.role];

  return (
    // --nav-h: chiều cao thanh điều hướng dưới trên điện thoại (thanh/thông báo cố định đặt phía trên nó)
    <div className="flex min-h-dvh flex-col [--nav-h:calc(4rem+env(safe-area-inset-bottom))] md:[--nav-h:0px]">
      <header className="sticky top-0 z-30 bg-header pt-[env(safe-area-inset-top)] text-header-fg shadow-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <BrandMark branding={branding} size={36} className="ring-1 ring-current/15" />
            <span className="truncate text-base font-bold tracking-tight">{branding.brandName}</span>
          </Link>

          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            {/* Đếm thông báo chưa đọc tải song song, không chặn hiển thị trang */}
            <Suspense fallback={<NotificationBell unread={0} />}>
              <UnreadNotificationBell employeeId={employee.id} />
            </Suspense>
            <Link href="/account" aria-label="Tài khoản của tôi" className="flex items-center gap-2.5 rounded-lg p-1 hover:bg-current/10">
              <Avatar name={employee.full_name} className="h-8 w-8 text-xs ring-2 ring-current/20" />
              <span className="hidden text-left leading-tight md:block">
                <span className="block max-w-[11rem] truncate text-sm font-semibold">{employee.full_name}</span>
                <span className="block text-xs opacity-70">{roleLabel}</span>
              </span>
            </Link>
            <span className="hidden md:block">
              <SignOutButton />
            </span>
          </div>
        </div>
      </header>

      <PushSync employeeId={employee.id} />
      {/* Realtime cho mọi trang: dữ liệu liên quan thay đổi → tự cập nhật */}
      <LiveSync employeeId={employee.id} />
      <NetworkStatus />
      <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 pt-5 pb-[calc(var(--nav-h)+1.5rem)] sm:pt-8 md:pb-8">
        {children}
      </main>

      <BottomNav nav={pickNavModules(modules)} modules={modules} fullName={employee.full_name} roleLabel={roleLabel} />
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
      className="relative rounded-lg p-2 hover:bg-current/10"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" />
      </svg>
      {unread ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white ring-2 ring-header">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
