/** Khung trang hiện ngay khi chuyển trang, trong lúc máy chủ tải dữ liệu (dùng cho loading.tsx). */
export default function PageSkeleton({ cards = 4, narrow = false }: { cards?: number; narrow?: boolean }) {
  return (
    <div className={`animate-pulse ${narrow ? "mx-auto max-w-2xl" : ""}`} role="status" aria-label="Đang tải">
      <div className="h-4 w-24 rounded bg-neutral-200" />
      <div className="mb-6 mt-3 h-8 w-56 max-w-full rounded-lg bg-neutral-200" />
      <div className="space-y-3">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="card space-y-3 p-4">
            <div className="h-4 w-1/3 rounded bg-neutral-200" />
            <div className="h-3 w-2/3 rounded bg-neutral-100" />
            <div className="h-3 w-1/2 rounded bg-neutral-100" />
          </div>
        ))}
      </div>
      <span className="sr-only">Đang tải...</span>
    </div>
  );
}
