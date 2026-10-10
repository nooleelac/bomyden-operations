import Link from "next/link";

/** Thanh điều hướng các trang bảng lương */
export default function PayrollNav({ active, isAdmin }: { active: "overview" | "advances" | "profiles" | "settings"; isAdmin: boolean }) {
  const tabs = [
    { key: "overview", href: "/payroll", label: "Bảng lương" },
    { key: "advances", href: "/payroll/advances", label: "Ứng lương" },
    { key: "profiles", href: "/payroll/profiles", label: "Hồ sơ lương" },
    ...(isAdmin ? [{ key: "settings", href: "/payroll/settings", label: "Cài đặt" }] : []),
  ];
  return (
    <div className="mb-5 inline-flex max-w-full overflow-x-auto [scrollbar-width:none] rounded-lg border border-neutral-200 bg-white p-1 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${active === tab.key ? "bg-brand text-brand-fg" : "text-neutral-600"}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
