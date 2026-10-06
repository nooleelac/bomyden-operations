"use client";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="card mx-auto max-w-md p-6 text-center">
      <h2 className="text-lg font-bold">Đã có lỗi xảy ra</h2>
      <p className="mt-2 text-sm text-neutral-500">
        Hệ thống không tải được dữ liệu. Vui lòng thử lại.
        {error.digest && <span className="mt-1 block text-xs">Mã lỗi: {error.digest}</span>}
      </p>
      <button type="button" onClick={() => retry()} className="btn-primary mt-5">
        Thử lại
      </button>
    </div>
  );
}
