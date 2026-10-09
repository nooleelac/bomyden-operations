import Link from "next/link";

type Tab = "stock" | "receipts" | "items" | "suppliers" | "settings";

/** Thanh điều hướng các trang Kho */
export default function InventoryNav({ active, isManager, isAdmin }: { active: Tab; isManager: boolean; isAdmin: boolean }) {
  const tabs: { key: Tab; href: string; label: string }[] = [
    { key: "stock", href: "/inventory", label: "Tồn kho" },
    { key: "receipts", href: "/inventory/receipts", label: "Phiếu nhập" },
    ...(isManager
      ? [
          { key: "items" as const, href: "/inventory/items", label: "Nguyên liệu" },
          { key: "suppliers" as const, href: "/inventory/suppliers", label: "Nhà cung cấp" },
        ]
      : []),
    ...(isAdmin ? [{ key: "settings" as const, href: "/inventory/settings", label: "Quyền" }] : []),
  ];
  return (
    <div className="mb-5 flex max-w-full overflow-x-auto">
      <div className="inline-flex shrink-0 rounded-lg border border-neutral-200 bg-white p-1 text-sm">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${active === tab.key ? "bg-neutral-900 text-white" : "text-neutral-600"}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
