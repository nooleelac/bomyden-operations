// Bàn giao ca: hằng số & nhãn dùng chung (client + server).

import type { HandoverStatus } from "@/lib/database.types";

export const HANDOVER_STATUS: Record<HandoverStatus, { label: string; className: string }> = {
  pending: { label: "Chờ nhận ca", className: "bg-amber-50 text-amber-800" },
  confirmed: { label: "Đã nhận", className: "bg-emerald-50 text-emerald-700" },
  disputed: { label: "Có sai lệch", className: "bg-red-50 text-red-700" },
};
