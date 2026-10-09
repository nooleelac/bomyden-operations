"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { formatMoney } from "@/lib/inventory";
import { saveSupplier } from "../actions";

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  note: string | null;
  payment_terms_days: number | null;
  is_active: boolean;
};

export default function SuppliersView({
  suppliers,
  monthTotals,
  debts,
}: {
  suppliers: SupplierRow[];
  monthTotals: Record<string, number>;
  debts: Record<string, number>;
}) {
  const [editing, setEditing] = useState<SupplierRow | "new" | null>(null);
  const [message, setMessage] = useState("");

  return (
    <div>
      {message && <p className="alert-success mb-4">{message}</p>}
      <button type="button" className="btn-primary mb-4" onClick={() => setEditing("new")}>+ Thêm nhà cung cấp</button>

      {suppliers.length === 0 ? (
        <p className="card p-8 text-center text-neutral-500">Chưa có nhà cung cấp. Nhà cung cấp cũng được tạo khi lưu phiếu nhập.</p>
      ) : (
        <ul className="card divide-y divide-neutral-100">
          {suppliers.map((s) => (
            <li key={s.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-50" onClick={() => setEditing(s)}>
                <div className="min-w-0">
                  <p className={`truncate font-medium ${s.is_active ? "" : "text-neutral-400 line-through"}`}>{s.name}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {[s.phone, s.address, s.payment_terms_days != null ? `nợ ${s.payment_terms_days} ngày` : null].filter(Boolean).join(" · ") ||
                      "Chưa có liên hệ"}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-neutral-500">
                  <p>Tháng này</p>
                  <p className="font-semibold text-neutral-800 tabular-nums">{formatMoney(monthTotals[s.id] ?? 0)}</p>
                  {debts[s.id] ? <p className="font-medium text-red-700 tabular-nums">Nợ {formatMoney(debts[s.id])}</p> : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <SupplierDialog
          supplier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(m) => {
            setEditing(null);
            setMessage(m);
          }}
        />
      )}
    </div>
  );
}

function SupplierDialog({ supplier, onClose, onDone }: { supplier: SupplierRow | null; onClose: () => void; onDone: (m: string) => void }) {
  const [state, action, pending] = useFormAction(saveSupplier.bind(null, supplier?.id ?? null), (r) => onDone(r.message));
  return (
    <Dialog open onClose={onClose} title={supplier ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp"}>
      <ActionForm action={action} className="space-y-4">
        <div>
          <label htmlFor="sup-name" className="mb-1.5 block text-sm font-medium text-neutral-700">Tên</label>
          <input id="sup-name" name="name" className="input" defaultValue={supplier?.name} required maxLength={150} />
          {state.fieldErrors?.name && <p className="field-error">{state.fieldErrors.name}</p>}
        </div>
        <div>
          <label htmlFor="sup-phone" className="mb-1.5 block text-sm font-medium text-neutral-700">Số điện thoại</label>
          <input id="sup-phone" name="phone" type="tel" className="input" defaultValue={supplier?.phone ?? ""} maxLength={30} />
        </div>
        <div>
          <label htmlFor="sup-address" className="mb-1.5 block text-sm font-medium text-neutral-700">Địa chỉ</label>
          <input id="sup-address" name="address" className="input" defaultValue={supplier?.address ?? ""} maxLength={300} />
        </div>
        <div>
          <label htmlFor="sup-terms" className="mb-1.5 block text-sm font-medium text-neutral-700">Số ngày được nợ</label>
          <input
            id="sup-terms"
            name="payment_terms_days"
            type="number"
            min={0}
            max={365}
            className="input"
            defaultValue={supplier?.payment_terms_days ?? ""}
            placeholder="vd: 30 — để trống nếu không có"
          />
          <p className="mt-1 text-xs text-neutral-500">Hạn thanh toán mặc định = ngày hóa đơn + số ngày này.</p>
          {state.fieldErrors?.payment_terms_days && <p className="field-error">{state.fieldErrors.payment_terms_days}</p>}
        </div>
        <div>
          <label htmlFor="sup-note" className="mb-1.5 block text-sm font-medium text-neutral-700">Ghi chú</label>
          <textarea id="sup-note" name="note" className="input" rows={2} defaultValue={supplier?.note ?? ""} maxLength={500} />
        </div>
        {supplier && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={supplier.is_active} className="h-4 w-4" />
            Đang giao dịch
          </label>
        )}
        {state.message && !state.ok && !state.fieldErrors && <p className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Hủy</button>
          <SubmitButton pending={pending}>Lưu</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
