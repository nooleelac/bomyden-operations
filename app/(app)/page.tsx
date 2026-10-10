import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { isManagerOrAdmin, mustClockIn } from "@/lib/auth/roles";
import { getModules } from "@/lib/modules";
import PushToggle from "@/components/PushToggle";
import { Suspense } from "react";
import { getManageableBranches } from "@/lib/branches";
import { getRequestTime } from "@/lib/request-time";
import { TIME_ZONE, vnDateString } from "@/lib/time";
import ManagerOverview from "./_overview/ManagerOverview";
import StaffOverview from "./_overview/StaffOverview";
import { OverviewSkeleton } from "./_overview/ui";

export const instant = false;

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const employee = await requireEmployee();
  const params = await searchParams;
  const modules = await getModules(employee);

  const isManager = isManagerOrAdmin(employee.role);
  const branches = isManager ? await getManageableBranches(employee) : [];
  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : "";
  const now = getRequestTime();
  const today = vnDateString(new Date(now));
  const dateLabel = new Intl.DateTimeFormat("vi-VN", { timeZone: TIME_ZONE, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(now));
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hour12: false }).format(new Date(now)));
  const greeting = hour < 11 ? "Chào buổi sáng" : hour < 14 ? "Chào buổi trưa" : hour < 18 ? "Chào buổi chiều" : "Chào buổi tối";

  return (
    <div>
      {params.error === "forbidden" && (
        <p className="alert-error mb-6">Bạn không có quyền truy cập trang đó.</p>
      )}

      <PushToggle compact />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <p className="text-sm first-letter:uppercase text-neutral-500">{dateLabel}</p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">{greeting}, {employee.full_name}</h1>
        </div>
        {branches.length > 1 && (
          <nav className="scroll-x gap-1.5 sm:flex-wrap" aria-label="Chọn chi nhánh">
            {[{ id: "", name: "Tất cả chi nhánh" }, ...branches].map((b) => (
              <Link
                key={b.id || "all"}
                href={b.id ? `/?branch=${b.id}` : "/"}
                aria-current={branchId === b.id ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  branchId === b.id ? "border-brand bg-brand text-brand-fg" : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                }`}
              >
                {b.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {isManager && branches.length === 0 ? (
        <p className="card p-6 text-center text-sm text-neutral-500">
          {employee.role === "admin" ? "Chưa có chi nhánh nào — tạo chi nhánh để bắt đầu." : "Bạn chưa được gán chi nhánh nào. Liên hệ Quản trị viên."}
        </p>
      ) : (
        <Suspense key={branchId} fallback={<OverviewSkeleton />}>
          {isManager ? (
            <div className="space-y-6">
              {mustClockIn(employee) && <StaffOverview me={employee} today={today} compact />}
              <ManagerOverview actor={employee} branches={branches} branchId={branchId} today={today} />
            </div>
          ) : (
            <StaffOverview me={employee} today={today} />
          )}
        </Suspense>
      )}

      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-wide text-neutral-500">Chức năng</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="card flex min-w-0 flex-col gap-2 p-4 transition hover:border-neutral-400 hover:shadow-md active:scale-[0.98] sm:flex-row sm:items-start sm:gap-4 sm:p-5"
          >
            <span className="text-2xl leading-none sm:text-3xl" aria-hidden="true">{module.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-snug sm:text-base">{module.title}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-500 sm:text-sm">{module.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
