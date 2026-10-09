import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { canAccessInventory, canAccessPayroll, canManageAttendance, canManageEmployees, isAdmin, isManagerOrAdmin, mustClockIn } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import PushToggle from "@/components/PushToggle";
import { Suspense } from "react";
import { getManageableBranches } from "@/lib/branches";
import { getRequestTime } from "@/lib/request-time";
import { TIME_ZONE, vnDateString } from "@/lib/time";
import ManagerOverview from "./_overview/ManagerOverview";
import StaffOverview from "./_overview/StaffOverview";
import { OverviewSkeleton } from "./_overview/ui";

export const instant = false;

type Module = {
  title: string;
  description: string;
  href?: string;
  icon: string;
};

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const employee = await requireEmployee();
  const params = await searchParams;

  // RLS: chỉ thấy hồ sơ lương của mình khi QTV đã cho phép xem phiếu lương
  const supabase = await createClient();
  const [{ data: ownProfile }, { data: hasPayrollProfile }] = await Promise.all([
    supabase.from("payroll_profiles").select("can_view_payslip").eq("employee_id", employee.id).maybeSingle(),
    supabase.rpc("has_payroll_profile"),
  ]);

  const modules: Module[] = [
    ...(employee.role !== "admin"
      ? [{ title: "Lịch làm việc", description: "Ca làm của chi nhánh, xin nghỉ / trễ / đổi ca", href: "/schedule", icon: "📅" }]
      : []),
    ...(canManageAttendance(employee.role)
      ? [{ title: "Xếp lịch & duyệt đơn", description: "Xếp ca, công bố lịch, duyệt đơn xin phép", href: "/schedule/manage", icon: "🗓️" }]
      : []),
    { title: "Checklist", description: "Công việc hôm nay của tôi", href: "/checklist", icon: "📋" },
    ...(canManageAttendance(employee.role)
      ? [{ title: "Quản lý checklist", description: "Mẫu công việc, báo cáo hằng ngày", href: "/checklist/manage", icon: "✅" }]
      : []),
    ...(mustClockIn(employee)
      ? [{ title: "Chấm công", description: "Vào ca / ra ca, lịch sử, yêu cầu sửa", href: "/attendance", icon: "🕐" }]
      : []),
    ...(canManageAttendance(employee.role)
      ? [{ title: "Quản lý chấm công", description: "Duyệt yêu cầu sửa, ai đang trong ca", href: "/attendance/manage", icon: "🗂️" }]
      : []),
    ...(canManageEmployees(employee.role)
      ? [{ title: "Nhân viên", description: "Tài khoản, chức vụ, chi nhánh", href: "/employees", icon: "👥" }]
      : []),
    ...(isAdmin(employee.role)
      ? [{ title: "Chi nhánh", description: "Vị trí GPS, Wi-Fi chấm công", href: "/branches", icon: "🏠" }]
      : []),
    ...(canAccessInventory(employee)
      ? [{ title: "Kho", description: "Chụp hóa đơn nhập kho, tồn kho, nhà cung cấp", href: "/inventory", icon: "📦" }]
      : []),
    ...(canAccessPayroll(employee)
      ? [{ title: "Bảng lương", description: "Tính lương, KPI, thưởng/phạt, chốt kỳ", href: "/payroll", icon: "💰" }]
      : []),
    ...(hasPayrollProfile
      ? [
          {
            title: "Phiếu lương của tôi",
            description: ownProfile?.can_view_payslip ? "Các kỳ lương đã chốt, ứng lương" : "Gửi đơn ứng lương",
            href: "/payslips",
            icon: "🧾",
          },
        ]
      : []),
    { title: "Tài khoản của tôi", description: "Thông tin cá nhân, đổi mật khẩu", href: "/account", icon: "🔐" },
  ];

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

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm first-letter:uppercase text-neutral-500">{dateLabel}</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{greeting}, {employee.full_name}</h1>
        </div>
        {branches.length > 1 && (
          <nav className="flex flex-wrap gap-1.5" aria-label="Chọn chi nhánh">
            {[{ id: "", name: "Tất cả chi nhánh" }, ...branches].map((b) => (
              <Link
                key={b.id || "all"}
                href={b.id ? `/?branch=${b.id}` : "/"}
                aria-current={branchId === b.id ? "page" : undefined}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                  branchId === b.id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) =>
          module.href ? (
            <Link
              key={module.title}
              href={module.href}
              className="card flex items-start gap-4 p-5 transition hover:border-neutral-400 hover:shadow-md"
            >
              <span className="text-3xl" aria-hidden="true">{module.icon}</span>
              <span>
                <span className="block font-semibold">{module.title}</span>
                <span className="mt-0.5 block text-sm text-neutral-500">{module.description}</span>
              </span>
            </Link>
          ) : (
            <div key={module.title} className="card flex items-start gap-4 p-5 opacity-60">
              <span className="text-3xl grayscale" aria-hidden="true">{module.icon}</span>
              <span>
                <span className="flex items-center gap-2 font-semibold">
                  {module.title}
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                    Sắp có
                  </span>
                </span>
                <span className="mt-0.5 block text-sm text-neutral-500">{module.description}</span>
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
