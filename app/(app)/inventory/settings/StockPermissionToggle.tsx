"use client";

import { startTransition } from "react";
import { useFormAction } from "@/components/useFormAction";
import { setStockPermission } from "../actions";

export default function StockPermissionToggle({
  employeeId,
  name,
  roleLabel,
  enabled,
}: {
  employeeId: string;
  name: string;
  roleLabel: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useFormAction(setStockPermission.bind(null, employeeId, !enabled));
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div>
        <p className="font-medium">{name}</p>
        <p className="text-xs text-neutral-500">{roleLabel}</p>
        {state.message && !state.ok && <p className="text-xs text-red-600">{state.message}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`Quyền nhập kho của ${name}`}
        disabled={pending}
        onClick={() => startTransition(() => action(new FormData()))}
        className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${enabled ? "bg-emerald-600" : "bg-neutral-300"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? "left-6" : "left-1"}`} />
      </button>
    </li>
  );
}
