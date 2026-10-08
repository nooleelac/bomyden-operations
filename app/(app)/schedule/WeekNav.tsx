import Link from "next/link";
import { addDays, weekLabel } from "@/lib/schedule";

type Props = {
  weekStart: string;
  currentWeek: string;
  branches: { id: string; name: string }[];
  branchId: string;
  /** Tham số giữ nguyên trên URL (ví dụ tab) */
  extra?: Record<string, string>;
};

/** Chọn chi nhánh + chuyển tuần (chỉ dùng link/GET form, không cần JS). */
export default function WeekNav({ weekStart, currentWeek, branches, branchId, extra = {} }: Props) {
  const href = (week: string) => "?" + new URLSearchParams({ ...extra, branch: branchId, week }).toString();
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 p-3">
      {branches.length > 1 && (
        <form method="get" className="flex items-center gap-2">
          {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="week" value={weekStart} />
          <label htmlFor="wk-branch" className="sr-only">Chi nhánh</label>
          <select id="wk-branch" name="branch" defaultValue={branchId} className="input py-1.5">
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="submit" className="btn-secondary py-1.5">Xem</button>
        </form>
      )}
      <div className="ml-auto flex items-center gap-1">
        <Link href={href(addDays(weekStart, -7))} className="rounded-lg px-2.5 py-1.5 text-sm hover:bg-neutral-100" aria-label="Tuần trước">←</Link>
        <span className="min-w-36 text-center text-sm font-semibold tabular-nums">{weekLabel(weekStart)}</span>
        <Link href={href(addDays(weekStart, 7))} className="rounded-lg px-2.5 py-1.5 text-sm hover:bg-neutral-100" aria-label="Tuần sau">→</Link>
        {weekStart !== currentWeek && (
          <Link href={href(currentWeek)} className="ml-1 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-50">Tuần này</Link>
        )}
      </div>
    </div>
  );
}
