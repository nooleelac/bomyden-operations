import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";

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
            <Link href="/account" className="text-right leading-tight hover:opacity-80">
              <span className="block max-w-[11rem] truncate text-sm font-semibold">
                {employee.full_name}
              </span>
              <span className="block text-xs text-neutral-400">{ROLE_LABELS[employee.role]}</span>
            </Link>

            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-lg border border-white/20 px-3 py-2 text-sm font-medium hover:bg-white/10"
              >
                Đăng xuất
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
