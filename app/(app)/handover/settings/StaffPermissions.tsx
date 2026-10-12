"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setItemStaff, setReceiver, type SaveResult } from "../actions";

type Item = { id: string; name: string; unit: string };
type Staff = { id: string; name: string; role: string; itemIds: string[]; canReceive: boolean };

/**
 * Phân quyền theo nhân viên (mặc định không ai có quyền):
 *  - Bàn giao: chọn món NV phụ trách → phiếu của NV gồm đủ các món này.
 *  - Nhận bàn giao: xác nhận mọi phiếu của chi nhánh (người cùng phụ trách món cũng nhận được phiếu của món đó).
 */
export default function StaffPermissions({ branchId, items, employees }: { branchId: string; items: Item[]; employees: Staff[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const run = (action: () => Promise<SaveResult>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? "" : result.message);
      if (result.ok) router.refresh();
    });

  const q = query.trim().toLowerCase();
  const shown = q ? employees.filter((e) => e.name.toLowerCase().includes(q)) : employees;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold tracking-tight">Phân quyền nhân viên</h2>
      <p className="mb-3 text-sm text-neutral-500">
        Mặc định không ai được bàn giao / nhận. Chọn món cho người <strong>bàn giao</strong> (phiếu của họ gồm đủ các món đã chọn). Bật{" "}
        <strong>Nhận bàn giao</strong> để xác nhận mọi phiếu của chi nhánh — người cùng phụ trách một món cũng nhận được phiếu có món đó.
      </p>
      {error && <p role="alert" className="alert-error mb-3">{error}</p>}

      {employees.length === 0 ? (
        <p className="card p-6 text-center text-sm text-neutral-500">Chi nhánh chưa có nhân viên.</p>
      ) : (
        <>
          {employees.length > 8 && (
            <input
              type="search"
              className="input mb-3 max-w-xs"
              placeholder="Tìm nhân viên..."
              aria-label="Tìm nhân viên"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <ul className="space-y-3">
            {shown.map((e) => (
              <li key={e.id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{e.name}</p>
                    <p className="text-xs text-neutral-500">
                      {e.role} · {e.itemIds.length > 0 ? `Bàn giao ${e.itemIds.length} món` : "Không bàn giao"}
                      {e.canReceive && " · Nhận bàn giao"}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={e.canReceive}
                      disabled={pending}
                      onChange={(ev) => run(() => setReceiver(branchId, e.id, ev.target.checked))}
                    />
                    Nhận bàn giao
                  </label>
                </div>
                {items.length === 0 ? (
                  <p className="mt-2 text-xs text-neutral-500">Thêm món ở trên trước khi giao món cho nhân viên.</p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Món ${e.name} bàn giao`}>
                    {items.map((item) => {
                      const on = e.itemIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={on}
                          disabled={pending}
                          onClick={() => run(() => setItemStaff(item.id, e.id, !on))}
                          className={`rounded-full border px-3 py-1.5 text-sm ${
                            on ? "border-brand bg-brand text-brand-fg" : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400"
                          }`}
                        >
                          {on ? "✓ " : "+ "}
                          {item.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
