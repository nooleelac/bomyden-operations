import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import PayrollNav from "../PayrollNav";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { EmployeeToggle, SettingsForm } from "./SettingsView";

export const metadata: Metadata = { title: "Cài đặt lương" };
export const instant = false;

export default async function PayrollSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: settings }, { data: managers }, { data: staff }] = await Promise.all([
    supabase.from("payroll_settings").select("*").single(),
    supabase.from("employees").select("id, full_name, can_manage_payroll").eq("role", "manager").eq("is_active", true).order("full_name"),
    supabase
      .from("employees")
      .select("id, full_name, role, auto_checkout_exempt")
      .eq("is_active", true)
      .eq("requires_attendance", true)
      .neq("role", "admin")
      .order("sort_order")
      .order("full_name"),
  ]);
  if (!settings) throw new Error("Không tải được cài đặt lương.");

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Cài đặt lương</h1>
      <PayrollNav active="settings" isAdmin />

      <SettingsForm settings={settings} />

      <section className="card mt-6 p-5">
        <h2 className="font-semibold">Quyền bảng lương của Quản lý</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Quản lý được bật sẽ xem, nhập điều chỉnh và chốt lương cho nhân viên thuộc chi nhánh mình (không gồm lương của
          chính mình và Quản lý khác).
        </p>
        {(managers ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">Chưa có Quản lý nào.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {managers!.map((m) => (
              <EmployeeToggle key={`${m.id}-${m.can_manage_payroll}`} kind="payroll" employeeId={m.id} name={m.full_name} enabled={m.can_manage_payroll} />
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-semibold">Miễn tự chốt ca</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Dành cho người hay làm thêm ngoài lịch (ví dụ bếp chính). Quên ra ca vẫn được nhắc nhưng app không tự chốt, và ra ca muộn
          hơn lịch vẫn tính đủ giờ (phiếu lương có cảnh báo để kiểm tra). Ca mở quá 16 giờ vẫn tính quên ra ca.
        </p>
        {(staff ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">Chưa có nhân viên phải chấm công.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {staff!.map((e) => (
              <EmployeeToggle
                key={`${e.id}-${e.auto_checkout_exempt}`}
                kind="exempt"
                employeeId={e.id}
                name={e.full_name}
                detail={ROLE_LABELS[e.role]}
                enabled={e.auto_checkout_exempt}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
