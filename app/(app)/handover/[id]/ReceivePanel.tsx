"use client";

import { useState } from "react";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { receiveHandover } from "../actions";

/** Người nhận ca: "Đã nhận đủ" hoặc "Báo sai lệch" (bắt buộc ghi rõ). */
export default function ReceivePanel({ handoverId }: { handoverId: string }) {
  const [mode, setMode] = useState<"ok" | "dispute" | null>(null);
  const close = () => setMode(null);
  const [okState, okAction, okPending] = useFormAction(receiveHandover.bind(null, handoverId, true), close);
  const [badState, badAction, badPending] = useFormAction(receiveHandover.bind(null, handoverId, false), close);
  const state = mode === "dispute" ? badState : okState;

  return (
    <div className="sticky bottom-(--nav-h) z-10 mt-4 border-t border-neutral-200 bg-white/95 py-3 backdrop-blur">
      <p className="mb-2 text-sm text-neutral-600">Bạn nhận ca? Đối chiếu ảnh và số lượng với thực tế:</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setMode("ok")} className="btn flex-1 bg-emerald-600 text-white hover:bg-emerald-700">
          ✓ Đã nhận đủ
        </button>
        <button type="button" onClick={() => setMode("dispute")} className="btn-secondary">
          Báo sai lệch
        </button>
      </div>

      <Dialog open={mode !== null} onClose={close} title={mode === "dispute" ? "Báo sai lệch" : "Xác nhận nhận ca"}>
        <form action={mode === "dispute" ? badAction : okAction} className="space-y-4">
          <div>
            <label htmlFor="receive-note" className="mb-1.5 block text-sm font-medium text-neutral-700">
              {mode === "dispute" ? (
                <>Sai lệch thế nào <span className="text-red-600">*</span></>
              ) : (
                "Ghi chú (tùy chọn)"
              )}
            </label>
            <textarea
              id="receive-note"
              name="note"
              rows={3}
              maxLength={1000}
              required={mode === "dispute"}
              placeholder={mode === "dispute" ? "vd: Thịt lõi vai cân lại chỉ còn 4,8 kg, thiếu 0,4 kg." : ""}
              className="input"
            />
            {state.fieldErrors?.note && <p className="field-error">{state.fieldErrors.note}</p>}
          </div>
          {mode === "dispute" && <p className="text-xs text-neutral-500">Quản lý và người giao ca sẽ nhận được thông báo.</p>}
          {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
          <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
            <button type="button" onClick={close} className="btn-secondary">Hủy</button>
            <SubmitButton pending={mode === "dispute" ? badPending : okPending} variant={mode === "dispute" ? "danger" : "primary"} pendingText="Đang lưu...">
              {mode === "dispute" ? "Gửi báo sai lệch" : "Xác nhận đã nhận"}
            </SubmitButton>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
