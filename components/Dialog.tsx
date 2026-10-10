"use client";

import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
};

/** Hộp thoại dùng thẻ <dialog> gốc của trình duyệt (có sẵn focus trap & phím Esc). */
export default function Dialog({ open, onClose, title, description, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="mx-auto mb-0 mt-auto w-full max-w-full rounded-t-3xl bg-white p-0 text-left shadow-xl open:animate-[sheet-up_0.22s_ease-out] sm:m-auto sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-2xl sm:open:animate-[pop-in_0.15s_ease-out]"
    >
      {open && (
        <div className="max-h-[90dvh] overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-h-[85dvh] sm:p-6">
          {/* Thanh kéo (trang trí) của tấm trượt trên điện thoại */}
          <div aria-hidden="true" className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-200 sm:hidden" />
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
              {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="-m-1 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
