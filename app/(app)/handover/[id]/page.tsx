import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { HANDOVER_STATUS } from "@/lib/handover";
import { signHandoverPhotos } from "@/lib/handover-photos";
import { formatQty } from "@/lib/inventory";
import { formatDateTime } from "@/lib/time";
import ReceivePanel from "./ReceivePanel";

export const metadata: Metadata = { title: "Phiếu bàn giao ca" };
export const instant = false;

export default async function HandoverDetailPage({ params }: PageProps<"/handover/[id]">) {
  const me = await requireEmployee();
  const { id } = await params;
  const supabase = await createClient();
  const { data: h } = await supabase
    .from("shift_handovers")
    .select(
      "id, branch_id, created_at, status, note, handed_by, handed_by_name, received_by_name, received_at, receive_note, branch:branches(name), shift_handover_lines(id, handover_item_id, item_name, unit, quantity, photo_path, photo_purged_at, sort_order)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!h) notFound();

  // Phiếu liền trước của chi nhánh → so sánh số lượng
  const { data: prev } = await supabase
    .from("shift_handovers")
    .select("created_at, shift_handover_lines(handover_item_id, quantity, unit)")
    .eq("branch_id", h.branch_id)
    .lt("created_at", h.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const previous = new Map((prev?.shift_handover_lines ?? []).map((l) => [l.handover_item_id, l]));

  const lines = [...h.shift_handover_lines].sort((a, b) => a.sort_order - b.sort_order);
  const photos = await signHandoverPhotos(lines.map((l) => (l.photo_purged_at ? null : l.photo_path)));
  const status = HANDOVER_STATUS[h.status];

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/handover" className="text-sm text-neutral-500 hover:text-neutral-900">← Bàn giao ca</Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Phiếu bàn giao ca</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        {formatDateTime(h.created_at)} · {h.branch?.name} · Người giao: <strong className="text-neutral-700">{h.handed_by_name}</strong>
      </p>

      {h.note && <p className="card mb-4 p-3 text-sm">📝 {h.note}</p>}

      {h.status !== "pending" && h.received_at && (
        <div className={`mb-4 rounded-xl p-3 text-sm ${h.status === "disputed" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>
          <p className="font-medium">
            {h.status === "disputed" ? "⚠️ Báo sai lệch" : "✓ Đã nhận ca"} — {h.received_by_name} · {formatDateTime(h.received_at)}
          </p>
          {h.receive_note && <p className="mt-1">{h.receive_note}</p>}
        </div>
      )}

      {prev && <p className="mb-2 text-xs text-neutral-500">So với phiếu trước lúc {formatDateTime(prev.created_at)}.</p>}

      <ul className="space-y-3">
        {lines.map((l) => {
          const url = l.photo_path ? photos.get(l.photo_path) : undefined;
          const p = l.handover_item_id ? previous.get(l.handover_item_id) : undefined;
          const diff = p && p.unit === l.unit ? Number(l.quantity) - Number(p.quantity) : null;
          return (
            <li key={l.id} className="card flex gap-3 p-3">
              {url ? (
                <a href={url} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Ảnh ${l.item_name}`} className="h-24 w-24 rounded-lg object-cover" />
                </a>
              ) : (
                <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-center text-xs text-neutral-400">
                  {l.photo_purged_at ? "Ảnh đã xóa (quá 3 tháng)" : "Không có ảnh"}
                </span>
              )}
              <div className="min-w-0">
                <p className="line-clamp-2 font-medium">{l.item_name}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {formatQty(l.quantity)} <span className="text-base font-normal text-neutral-500">{l.unit}</span>
                </p>
                {diff !== null && (
                  <p className="text-xs text-neutral-500">
                    Lần trước {formatQty(p!.quantity)} {l.unit}
                    {diff !== 0 && (
                      <span className={diff < 0 ? " text-amber-700" : " text-sky-700"}>
                        {" "}({diff > 0 ? "+" : "−"}{formatQty(Math.abs(diff))})
                      </span>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {h.status === "pending" &&
        (h.handed_by === me.id ? (
          <p className="alert-info mt-4">Đang chờ người nhận ca kiểm tra và xác nhận.</p>
        ) : (
          <ReceivePanel handoverId={h.id} />
        ))}
    </div>
  );
}
