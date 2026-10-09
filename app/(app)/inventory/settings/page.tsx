import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/inventory";
import InventoryNav from "../InventoryNav";
import StockPermissionToggle from "./StockPermissionToggle";

export const metadata: Metadata = { title: "Quyền nhập kho" };
export const instant = false;

// Giá Claude Haiku 5.5 (USD / 1 triệu token) — chỉ để ước tính chi phí hiển thị
const USD_PER_M_INPUT = 0.1;
const USD_PER_M_OUTPUT = 0.5;
const VND_PER_USD = 26_000;

export default async function InventorySettingsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const monthStart = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()).slice(0, 7) + "-01";
  const [staffRes, scansRes] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, role, can_receive_stock")
      .eq("is_active", true)
      .not("role", "in", "(admin,manager)")
      .order("full_name"),
    supabase
      .from("invoice_scans")
      .select("model, input_tokens, output_tokens, receipt_id")
      .gte("created_at", `${monthStart}T00:00:00+07:00`),
  ]);

  const scans = scansRes.data ?? [];
  const isHaiku = scans.every((s) => !s.model || s.model.startsWith("claude-haiku"));
  const usd = scans.reduce(
    (t, s) => t + ((s.input_tokens ?? 0) * USD_PER_M_INPUT + (s.output_tokens ?? 0) * USD_PER_M_OUTPUT) / 1_000_000,
    0
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← Kho</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Quyền nhập kho</h1>
      <InventoryNav active="settings" isManager isAdmin />

      <section className="card p-5">
        <h2 className="font-semibold">Nhân viên được nhập kho</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Quản trị viên và Quản lý luôn được nhập kho. Bật cho nhân viên khác (bếp chính, thu ngân…) để họ chụp hóa đơn nhập
          hàng cho chi nhánh của mình. Họ chỉ xem tồn kho và phiếu nhập, không sửa danh mục, không hủy phiếu.
        </p>
        {(staffRes.data ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">Chưa có nhân viên nào.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-100">
            {staffRes.data!.map((e) => (
              <StockPermissionToggle
                key={`${e.id}-${e.can_receive_stock}`}
                employeeId={e.id}
                name={e.full_name}
                roleLabel={ROLE_LABELS[e.role]}
                enabled={e.can_receive_stock}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-semibold">Chi phí AI đọc hóa đơn tháng này</h2>
        <p className="mt-2 text-sm text-neutral-600">
          {scans.length} lượt quét · {scans.filter((s) => s.receipt_id).length} lượt đã lưu thành phiếu
        </p>
        <p className="mt-1 text-sm text-neutral-600">
          Ước tính: <strong className="text-neutral-900">{formatMoney(usd * VND_PER_USD)}</strong> (≈ ${usd.toFixed(3)})
          {!isHaiku && " — có lượt dùng mô hình khác Haiku, số ước tính có thể thấp hơn thực tế"}
        </p>
        <p className="mt-2 text-xs text-neutral-400">Số chính xác xem tại console.anthropic.com → Usage.</p>
      </section>
    </div>
  );
}
