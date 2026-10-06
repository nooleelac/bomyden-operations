"use client";

import { startTransition } from "react";
import { useFormAction } from "@/components/useFormAction";
import { cancelCorrection } from "./actions";

export default function CancelCorrectionButton({ correctionId }: { correctionId: string }) {
  const [state, action, pending] = useFormAction(cancelCorrection.bind(null, correctionId));

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Hủy yêu cầu sửa này?")) startTransition(() => action(new FormData()));
        }}
        className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
      >
        {pending ? "Đang hủy..." : "Hủy yêu cầu"}
      </button>
      {state.message && !state.ok && <span className="text-xs text-red-600">{state.message}</span>}
    </span>
  );
}
