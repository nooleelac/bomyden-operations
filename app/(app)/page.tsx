import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { canManageAttendance, canManageEmployees, isAdmin, mustClockIn } from "@/lib/auth/roles";

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

  const modules: Module[] = [
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
    { title: "Tài khoản của tôi", description: "Thông tin cá nhân, đổi mật khẩu", href: "/account", icon: "🔐" },
    { title: "Checklist", description: "Công việc hằng ngày", icon: "📋" },
    { title: "Lịch làm việc", description: "Ca làm & xin phép", icon: "📅" },
  ];

  return (
    <div>
      {params.error === "forbidden" && (
        <p className="alert-error mb-6">Bạn không có quyền truy cập trang đó.</p>
      )}

      <h1 className="text-2xl font-bold tracking-tight">Xin chào, {employee.full_name}</h1>
      <p className="mt-1 text-neutral-500">Chọn chức năng để bắt đầu.</p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
