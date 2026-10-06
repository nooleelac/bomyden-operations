import type { AttendanceMethod, CorrectionStatus } from "@/lib/database.types";

const METHOD_LABEL: Record<AttendanceMethod, string> = {
  gps: "📍 GPS",
  wifi: "📶 Wi-Fi",
  manual: "✍️ Thủ công",
};

export function MethodBadge({ method, prefix }: { method: AttendanceMethod; prefix?: string }) {
  return (
    <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
      {prefix ? `${prefix}: ` : ""}
      {METHOD_LABEL[method]}
    </span>
  );
}

const STATUS: Record<CorrectionStatus, { label: string; className: string }> = {
  pending: { label: "Chờ duyệt", className: "bg-amber-50 text-amber-800" },
  approved: { label: "Đã duyệt", className: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Từ chối", className: "bg-red-50 text-red-700" },
  cancelled: { label: "Đã hủy", className: "bg-neutral-100 text-neutral-500" },
};

export function CorrectionStatusBadge({ status }: { status: CorrectionStatus }) {
  const item = STATUS[status];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${item.className}`}>{item.label}</span>;
}
