import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import PayrollNav from "../PayrollNav";
import { ManagerAccessToggle, SettingsForm } from "./SettingsView";

export const metadata: Metadata = { title: "Cài đặt lương" };
export const instant = false;

export default async function PayrollSettingsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: settings }, { data: managers }] = await Promise.all([
    supabase.from("payroll_settings").select("*").single(),
    supabase.from("employees").select("id, full_name, can_manage_payroll").eq("role", "manager").eq("is_active", true).order("full_name"),
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
              <ManagerAccessToggle key={`${m.id}-${m.can_manage_payroll}`} employeeId={m.id} name={m.full_name} enabled={m.can_manage_payroll} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
