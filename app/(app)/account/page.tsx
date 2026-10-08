import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { formatPhone } from "@/lib/phone";
import ChangePasswordForm from "./ChangePasswordForm";
import PushToggle from "@/components/PushToggle";

export const metadata: Metadata = { title: "Tài khoản của tôi" };
export const instant = false;

export default async function AccountPage() {
  const employee = await requireEmployee();

  const info = [
    { label: "Họ tên", value: employee.full_name },
    { label: "Chức vụ", value: ROLE_LABELS[employee.role] },
    { label: "Email", value: employee.email ?? "—" },
    { label: "Số điện thoại", value: employee.phone ? formatPhone(employee.phone) : "—" },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Trang chủ
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Tài khoản của tôi</h1>

      <section className="card mt-6 p-5 sm:p-6">
        <h2 className="font-semibold">Thông tin</h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {info.map((item) => (
            <div key={item.label}>
              <dt className="text-sm text-neutral-500">{item.label}</dt>
              <dd className="mt-0.5 font-medium">{item.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-neutral-400">
          Cần sửa thông tin? Liên hệ Quản lý hoặc Quản trị viên.
        </p>
      </section>

      <PushToggle />

      <section className="card mt-6 p-5 sm:p-6">
        <h2 className="mb-4 font-semibold">Đổi mật khẩu</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
