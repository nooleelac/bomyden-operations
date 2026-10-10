// Khối giao diện dùng chung cho trang Tổng quan.

import Link from "next/link";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-neutral-900",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-red-700",
  info: "text-sky-700",
};

export const TONE_BADGE: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-red-50 text-red-700",
  info: "bg-sky-50 text-sky-700",
};

/** Ô chỉ số: nhãn + số lớn + dòng phụ, bấm để mở trang chi tiết. */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  href,
  progress,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  href: string;
  progress?: number;
}) {
  return (
    <Link
      href={href}
      className={`card group flex min-w-0 flex-col p-3.5 transition active:scale-[0.98] sm:p-4 hover:border-neutral-400 hover:shadow-md ${tone === "bad" ? "border-red-200" : ""}`}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</span>
      <span className={`mt-1.5 text-2xl font-bold tabular-nums sm:text-3xl ${TONE_TEXT[tone]}`}>{value}</span>
      {progress !== undefined && (
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
          <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
      {sub && <span className="mt-1.5 text-xs text-neutral-500">{sub}</span>}
    </Link>
  );
}

export function SectionCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action && (
          <Link href={action.href} className="shrink-0 text-xs font-medium text-neutral-500 hover:text-neutral-900">
            {action.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_BADGE[tone]}`}>{children}</span>;
}

export type ActionItem = { key: string; icon: string; text: string; detail?: string; href: string; tone: Tone; count: number };

/** Danh sách "Cần xử lý": chỉ hiện mục có số > 0; rỗng = mọi thứ ổn. */
export function ActionList({ items, emptyText }: { items: ActionItem[]; emptyText: string }) {
  const visible = items.filter((i) => i.count > 0);
  if (visible.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-emerald-700">✓ {emptyText}</p>;
  }
  return (
    <ul className="divide-y divide-neutral-100">
      {visible.map((item) => (
        <li key={item.key}>
          <Link href={item.href} className="flex items-center gap-3 px-4 py-3 transition hover:bg-neutral-50">
            <span className="text-xl" aria-hidden="true">{item.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{item.text}</span>
              {item.detail && <span className="block truncate text-xs text-neutral-500">{item.detail}</span>}
            </span>
            <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-bold tabular-nums ${TONE_BADGE[item.tone]}`}>
              {item.count}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="animate-pulse space-y-4" role="status" aria-label="Đang tải tổng quan">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card h-28 p-4">
            <div className="h-3 w-20 rounded bg-neutral-200" />
            <div className="mt-3 h-7 w-16 rounded bg-neutral-200" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card h-48" />
        <div className="card h-48" />
      </div>
      <span className="sr-only">Đang tải...</span>
    </div>
  );
}
