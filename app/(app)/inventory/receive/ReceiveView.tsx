"use client";

import { startTransition, useActionState, useState } from "react";
import { resizeImage } from "@/components/image-resize";
import { scanInvoice } from "./actions";
import ReceiptForm from "./ReceiptForm";
import type { BranchRef } from "@/lib/branches";
import type { CatalogItem, LastPrices, ReceiptDraft, ScanState, SupplierOption } from "./types";

type Props = {
  branches: BranchRef[];
  catalog: CatalogItem[];
  suppliers: SupplierOption[];
  lastPrices: LastPrices;
  aiReady: boolean;
};

function manualDraft(): ReceiptDraft {
  return {
    scanId: null,
    photoUrl: null,
    supplierId: null,
    newSupplierName: "",
    invoiceNumber: "",
    invoiceDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()),
    invoiceTotal: "",
    warning: null,
    lines: [],
  };
}

/** Bước 1: chọn chi nhánh + chụp ảnh. Bước 2: xem lại & lưu (ReceiptForm). */
export default function ReceiveView({ branches, catalog, suppliers, lastPrices, aiReady }: Props) {
  const [branchId, setBranchId] = useState(branches[0].id);
  const [preparing, setPreparing] = useState(false);
  const [manual, setManual] = useState<ReceiptDraft | null>(null);
  const [state, scan, scanning] = useActionState(
    (prev: ScanState, formData: FormData) => scanInvoice(branchId, prev, formData),
    { ok: false, message: "" } as ScanState
  );
  // Đổi key mỗi lần quét xong để form xác nhận khởi tạo lại từ bản nháp mới
  const [round, setRound] = useState(0);
  const [showDraft, setShowDraft] = useState(false);

  async function onPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPreparing(true);
    // Hóa đơn cần chữ rõ → giữ ảnh lớn hơn ảnh checklist một chút
    const resized = await resizeImage(file, 2000, 0.85);
    setPreparing(false);
    const formData = new FormData();
    formData.set("photo", resized);
    setManual(null);
    setShowDraft(true);
    setRound((r) => r + 1);
    startTransition(() => scan(formData));
  }

  const busy = preparing || scanning;
  const draft = manual ?? (showDraft && !busy ? state.draft : undefined);

  if (draft) {
    return (
      <div>
        {!manual && state.message && <p className={`${state.ok ? "alert-info" : "alert-error"} mb-4`}>{state.message}</p>}
        <ReceiptForm
          key={manual ? "manual" : `scan-${round}`}
          branchId={branchId}
          branchName={branches.find((b) => b.id === branchId)?.name ?? ""}
          draft={draft}
          catalog={catalog}
          suppliers={suppliers}
          lastPrices={lastPrices}
          onCancel={() => {
            setManual(null);
            setShowDraft(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {branches.length > 1 && (
        <div className="card p-4">
          <label htmlFor="branch" className="mb-1.5 block text-sm font-medium text-neutral-700">Nhập cho chi nhánh</label>
          <select id="branch" className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={busy}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}

      {!aiReady && (
        <p className="alert-info">
          Chưa cài khóa AI nên chưa đọc ảnh tự động được. Bạn vẫn có thể nhập tay (ảnh vẫn được lưu kèm phiếu).
        </p>
      )}
      {showDraft && !busy && !state.draft && state.message && <p className="alert-error">{state.message}</p>}

      {busy ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center" role="status" aria-live="polite">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900" aria-hidden="true" />
          <p className="font-semibold">{preparing ? "Đang chuẩn bị ảnh..." : "AI đang đọc hóa đơn..."}</p>
          <p className="text-sm text-neutral-500">Thường mất 10–20 giây. Đừng tắt màn hình.</p>
        </div>
      ) : (
        <>
          <label className="card flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed border-neutral-300 p-8 text-center transition hover:border-neutral-500">
            <span className="text-5xl" aria-hidden="true">📷</span>
            <span className="text-lg font-semibold">Chụp ảnh hóa đơn</span>
            <span className="text-sm text-neutral-500">Chụp thẳng, đủ sáng, thấy rõ toàn bộ các dòng hàng và tổng tiền</span>
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={onPhoto} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="btn-secondary cursor-pointer">
              🖼️ Chọn ảnh có sẵn
              <input type="file" accept="image/*" className="sr-only" onChange={onPhoto} />
            </label>
            <button type="button" className="btn-secondary" onClick={() => setManual(manualDraft())}>
              ✍️ Nhập tay
            </button>
          </div>
        </>
      )}
    </div>
  );
}
