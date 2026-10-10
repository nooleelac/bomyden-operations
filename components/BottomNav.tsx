"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Dialog from "@/components/Dialog";
import NavIcon from "@/components/NavIcon";
import SignOutButton from "@/components/SignOutButton";

type Item = { href: string; short: string; title: string; icon: string; description: string };

/** Mục đang mở = mục có đường dẫn khớp dài nhất (VD /checklist/manage thắng /checklist). */
function activeHref(pathname: string, hrefs: string[]) {
  if (pathname === "/") return "/";
  return hrefs
    .filter((h) => h !== "/" && (pathname === h || pathname.startsWith(`${h}/`)))
    .sort((a, b) => b.length - a.length)[0];
}

/** Thanh điều hướng cố định dưới màn hình (chỉ trên điện thoại) + Menu đầy đủ chức năng. */
export default function BottomNav({
  nav,
  modules,
  fullName,
  roleLabel,
}: {
  nav: Item[];
  modules: Item[];
  fullName: string;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const tabs = [{ href: "/", short: "Trang chủ" }, ...nav];
  const active = activeHref(pathname, tabs.map((t) => t.href));
  const menuActive = !active;

  return (
    <>
      <nav
        aria-label="Điều hướng chính"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto flex h-16 max-w-lg">
          {tabs.map((t) => {
            const on = active === t.href;
            return (
              <li key={t.href} className="min-w-0 flex-1">
                <Link
                  href={t.href}
                  aria-current={on ? "page" : undefined}
                  className={`flex h-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition ${on ? "text-brand" : "text-neutral-500"}`}
                >
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${on ? "bg-brand/10" : ""}`}>
                    <NavIcon name={t.href} />
                  </span>
                  <span className="w-full truncate text-center">{t.short}</span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-haspopup="dialog"
              className={`flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium ${menuActive ? "text-brand" : "text-neutral-500"}`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full ${menuActive ? "bg-brand/10" : ""}`}>
                <NavIcon name="menu" />
              </span>
              <span>Menu</span>
            </button>
          </li>
        </ul>
      </nav>

      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <MenuContent modules={modules} fullName={fullName} roleLabel={roleLabel} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
      </Dialog>
    </>
  );
}

function MenuContent({
  modules,
  fullName,
  roleLabel,
  pathname,
  onNavigate,
}: {
  modules: Item[];
  fullName: string;
  roleLabel: string;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = activeHref(pathname, modules.map((m) => m.href));
  return (
    <div className="space-y-4">
      <Link href="/account" onClick={onNavigate} className="flex items-center gap-3 rounded-xl bg-neutral-50 p-3 transition hover:bg-neutral-100">
        <Avatar name={fullName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{fullName}</span>
          <span className="block text-xs text-neutral-500">{roleLabel} · Tài khoản của tôi</span>
        </span>
        <span aria-hidden="true" className="text-neutral-400">›</span>
      </Link>

      <ul className="grid grid-cols-3 gap-2">
        {modules.map((m) => (
          <li key={m.href}>
            <Link
              href={m.href}
              onClick={onNavigate}
              aria-current={active === m.href ? "page" : undefined}
              className={`flex h-full flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs font-medium transition ${
                active === m.href ? "border-brand bg-brand/5 text-brand" : "border-neutral-200 text-neutral-700 hover:border-neutral-400"
              }`}
            >
              <span className="text-2xl leading-none" aria-hidden="true">{m.icon}</span>
              <span className="leading-tight">{m.title}</span>
            </Link>
          </li>
        ))}
      </ul>

      <SignOutButton variant="light" />
    </div>
  );
}

export function Avatar({ name, className = "h-10 w-10 text-sm" }: { name: string; className?: string }) {
  const parts = name.trim().split(/\s+/);
  const initials = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) ?? "?").toUpperCase();
  return (
    <span aria-hidden="true" className={`flex shrink-0 items-center justify-center rounded-full bg-brand font-bold text-brand-fg ${className}`}>
      {initials}
    </span>
  );
}
