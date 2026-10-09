import Link from "next/link";
import type { BranchRef } from "@/lib/branches";

/** Nút chọn chi nhánh (chỉ hiện khi có từ 2 chi nhánh). branchId "" = tất cả (khi allowAll). */
export default function BranchChips({
  branches,
  branchId,
  href,
  allowAll = false,
}: {
  branches: BranchRef[];
  branchId: string;
  href: (branchId: string) => string;
  allowAll?: boolean;
}) {
  if (branches.length < 2) return null;
  const options = allowAll ? [{ id: "", name: "Tất cả" }, ...branches] : branches;
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {options.map((b) => (
        <Link
          key={b.id || "all"}
          href={href(b.id)}
          className={`rounded-full border px-3 py-1 text-sm font-medium ${b.id === branchId ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
        >
          {b.name}
        </Link>
      ))}
    </div>
  );
}
