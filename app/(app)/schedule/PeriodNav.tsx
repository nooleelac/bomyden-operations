import Link from "next/link";
import type { Period } from "@/lib/schedule";

type Props = {
  period: Period;
  branches: { id: string; name: string }[];
  branchId: string;
  /** Tham số giữ nguyên trên URL (ví dụ tab) */
  extra?: Record<string, string>;
};

/** Chọn chi nhánh + xem theo tuần / tháng + chuyển kỳ (chỉ dùng link/GET form). */
export default function PeriodNav({ period, branches, branchId, extra = {} }: Props) {
  const base = { ...extra, branch: branchId };
  const href = (q: Record<string, string>) => "?" + new URLSearchParams({ ...base, mode: period.mode, ...q }).toString();
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
      {branches.length > 1 && (
        <form method="get" className="flex items-center gap-2">
          {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="mode" value={period.mode} />
          <label htmlFor="pn-branch" className="sr-only">Chi nhánh</label>
          <select id="pn-branch" name="branch" defaultValue={branchId} className="input py-1.5">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="submit" className="btn-secondary py-1.5">Xem</button>
        </form>
      )}
      <div className="flex rounded-lg border border-neutral-200 p-0.5 text-sm">
        {(["week", "month"] as const).map((m) => (
          <Link
            key={m}
            href={"?" + new URLSearchParams({ ...base, mode: m }).toString()}
            aria-current={period.mode === m ? "page" : undefined}
            className={`rounded-md px-3 py-1 font-medium ${period.mode === m ? "bg-brand text-brand-fg" : "text-neutral-600"}`}
          >
            {m === "week" ? "Theo tuần" : "Theo tháng"}
          </Link>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Link href={href({ start: period.prev })} className="rounded-lg px-2.5 py-1.5 text-sm hover:bg-neutral-100" aria-label="Kỳ trước">←</Link>
        <span className="min-w-36 text-center text-sm font-semibold tabular-nums">{period.label}</span>
        <Link href={href({ start: period.next })} className="rounded-lg px-2.5 py-1.5 text-sm hover:bg-neutral-100" aria-label="Kỳ sau">→</Link>
      </div>
    </div>
  );
}
