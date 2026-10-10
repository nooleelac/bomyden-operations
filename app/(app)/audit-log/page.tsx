import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isValidDateString, formatTime, vnDateString, vnDayRange } from "@/lib/time";
import { getRequestTime } from "@/lib/request-time";
import {
  AUDIT_GROUPS,
  auditChanges,
  auditSubject,
  auditVerb,
  collectRefIds,
  tableLabel,
  type AuditRefs,
  type AuditTone,
} from "@/lib/audit-log";
import HistoryFilters from "@/components/HistoryFilters";

export const metadata: Metadata = { title: "Nhật ký thao tác" };
export const instant = false;

/** Xem tối đa 92 ngày một lần (nhật ký giữ 12 tháng) */
const MAX_RANGE_DAYS = 92;
const PAGE_SIZE = 100;
const MAX_ROWS = 1000;

const WEEKDAY_NAMES = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

const TONE_CLASSES: Record<AuditTone, string> = {
  add: "bg-emerald-50 text-emerald-700",
  edit: "bg-amber-50 text-amber-800",
  remove: "bg-red-50 text-red-700",
  approve: "bg-sky-50 text-sky-700",
  reject: "bg-red-50 text-red-700",
};

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function AuditLogPage({ searchParams }: PageProps<"/audit-log">) {
  await requireAdmin();
  const params = await searchParams;
  const today = vnDateString(new Date(getRequestTime()));

  let from = isValidDateString(params.from) ? params.from : today;
  let to = isValidDateString(params.to) ? params.to : today;
  if (to > today) to = today;
  if (from > to) from = to;
  if (from < addDays(to, -(MAX_RANGE_DAYS - 1))) from = addDays(to, -(MAX_RANGE_DAYS - 1));

  const group = AUDIT_GROUPS.find((g) => g.key === params.group);
  const limitParam = Number(typeof params.limit === "string" ? params.limit : PAGE_SIZE);
  const limit = Math.min(MAX_ROWS, Math.max(PAGE_SIZE, Number.isFinite(limitParam) ? Math.round(limitParam / PAGE_SIZE) * PAGE_SIZE : PAGE_SIZE));

  const supabase = await createClient();
  const [{ data: employees, error: empError }, { data: branches, error: branchError }] = await Promise.all([
    supabase.from("employees").select("id, full_name, is_active").order("full_name"),
    supabase.from("branches").select("id, name, is_active").order("name"),
  ]);
  if (empError || branchError) throw new Error("Không tải được dữ liệu nhật ký.");

  const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : "";
  const actorIds =
    typeof params.emp === "string" ? params.emp.split(",").filter((id) => employees.some((e) => e.id === id)) : [];

  let query = supabase
    .from("audit_logs")
    .select("id, table_name, action, actor_employee_id, branch_id, target_employee_id, old_data, new_data, note, created_at")
    .gte("created_at", vnDayRange(from).start)
    .lt("created_at", vnDayRange(to).end)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (actorIds.length) query = query.in("actor_employee_id", actorIds);
  if (group) query = query.in("table_name", group.tables);
  if (branchId) {
    // Dòng của chi nhánh, hoặc dòng không gắn chi nhánh (hồ sơ lương, nhân viên...) về nhân viên thuộc chi nhánh
    const { data: members } = await supabase.from("employee_branches").select("employee_id").eq("branch_id", branchId);
    const memberIds = (members ?? []).map((m) => m.employee_id);
    query = memberIds.length
      ? query.or(`branch_id.eq.${branchId},and(branch_id.is.null,target_employee_id.in.(${memberIds.join(",")}))`)
      : query.eq("branch_id", branchId);
  }
  const { data: logRows, error } = await query;
  if (error) throw new Error("Không tải được nhật ký thao tác.");

  const hasMore = logRows.length > limit;
  const rows = logRows.slice(0, limit);

  // Tra tên cho các mã trong dữ liệu
  const ids = collectRefIds(rows);
  const [suppliersRes, setsRes, itemsRes] = await Promise.all([
    ids.suppliers.size ? supabase.from("suppliers").select("id, name").in("id", [...ids.suppliers]) : Promise.resolve({ data: [] }),
    ids.taskSets.size ? supabase.from("task_sets").select("id, name").in("id", [...ids.taskSets]) : Promise.resolve({ data: [] }),
    ids.items.size ? supabase.from("inventory_items").select("id, name").in("id", [...ids.items]) : Promise.resolve({ data: [] }),
  ]);
  const refs: AuditRefs = {
    employees: new Map(employees.map((e) => [e.id, e.full_name])),
    branches: new Map(branches.map((b) => [b.id, b.name])),
    suppliers: new Map((suppliersRes.data ?? []).map((s) => [s.id, s.name])),
    taskSets: new Map((setsRes.data ?? []).map((s) => [s.id, s.name])),
    items: new Map((itemsRes.data ?? []).map((s) => [s.id, s.name])),
  };

  const entries = rows.map((row) => {
    const { verb, tone } = auditVerb(row.table_name, row.action, row.old_data, row.new_data);
    return {
      id: row.id,
      day: vnDateString(new Date(row.created_at)),
      time: formatTime(row.created_at),
      verb,
      tone,
      object: tableLabel(row.table_name),
      subject: auditSubject(row.table_name, row.old_data, row.new_data, refs),
      actor: row.actor_employee_id ? (refs.employees.get(row.actor_employee_id) ?? "(đã xóa)") : "Hệ thống",
      branch: row.branch_id ? refs.branches.get(row.branch_id) : undefined,
      note: row.note,
      ...auditChanges(row.table_name, row.action, row.old_data, row.new_data, refs),
    };
  });
  const days = [...new Set(entries.map((e) => e.day))];

  const query_: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && k !== "limit") query_[k] = v;
  const hrefWith = (patch: Record<string, string>) => {
    const next = new URLSearchParams(query_);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    return s ? `/audit-log?${s}` : "/audit-log";
  };

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Trang chủ
      </Link>
      <div className="mb-4 mt-2">
        <h1 className="text-2xl font-bold tracking-tight">Nhật ký thao tác</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ai đã thêm / sửa / xóa / duyệt gì và lúc nào. Không ghi việc thường ngày của nhân viên (vào/ra ca, đánh dấu
          checklist, gửi đơn). Tự xóa sau 12 tháng.
        </p>
      </div>

      <HistoryFilters
        mode="full"
        branches={branches.map((b) => ({ id: b.id, name: b.is_active ? b.name : `${b.name} (ngừng)` }))}
        staff={employees.map((e) => ({ id: e.id, name: e.is_active ? e.full_name : `${e.full_name} (đã khóa)` }))}
        branchId={branchId}
        employeeIds={actorIds}
        from={from}
        to={to}
        today={today}
        maxDays={MAX_RANGE_DAYS}
        query={query_}
        staffFieldLabel="Người thao tác"
      />

      <nav className="scroll-x mb-4 gap-1.5" aria-label="Lọc theo chức năng">
        {[{ key: "", label: "Tất cả" }, ...AUDIT_GROUPS].map((g) => {
          const active = (group?.key ?? "") === g.key;
          return (
            <Link
              key={g.key || "all"}
              href={hrefWith({ group: g.key })}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active ? "border-brand bg-brand text-brand-fg" : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
              }`}
            >
              {g.label}
            </Link>
          );
        })}
      </nav>

      {entries.length === 0 ? (
        <p className="card px-4 py-10 text-center text-sm text-neutral-500">Không có thao tác nào trong khoảng này.</p>
      ) : (
        <div className="space-y-5">
          {days.map((day) => {
            const items = entries.filter((e) => e.day === day);
            const [y, m, d] = day.split("-");
            return (
              <section key={day}>
                <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
                  <h2 className="text-sm font-semibold">
                    {WEEKDAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()]}, <span className="tabular-nums">{d}/{m}/{y}</span>
                  </h2>
                  <p className="shrink-0 text-xs text-neutral-500">{items.length} thao tác</p>
                </div>
                <ul className="card divide-y divide-neutral-100 overflow-hidden">
                  {items.map((e) => (
                    <li key={e.id}>
                      <details className="group">
                        <summary className="flex cursor-pointer list-none gap-3 px-3 py-3 hover:bg-neutral-50 sm:px-4 [&::-webkit-details-marker]:hidden">
                          <span className="w-11 shrink-0 pt-0.5 text-xs font-medium tabular-nums text-neutral-500">{e.time}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                              <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[e.tone]}`}>{e.verb}</span>
                              <span className="font-medium">{e.object}</span>
                            </span>
                            {e.subject && <span className="mt-0.5 block truncate text-sm text-neutral-700">{e.subject}</span>}
                            <span className="mt-0.5 block text-xs text-neutral-500">
                              bởi <span className="font-medium text-neutral-700">{e.actor}</span>
                              {e.branch && <> · {e.branch}</>}
                            </span>
                          </span>
                          <svg
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="mt-1 h-4 w-4 shrink-0 text-neutral-400 transition group-open:rotate-180"
                            aria-hidden="true"
                          >
                            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                          </svg>
                        </summary>
                        <div className="border-t border-neutral-100 bg-neutral-50 px-3 py-3 sm:px-4">
                          {e.note && <p className="mb-2 text-sm"><span className="text-neutral-500">Lý do:</span> {e.note}</p>}
                          {e.changes.length === 0 ? (
                            <p className="text-sm text-neutral-500">Không có thay đổi hiển thị được.</p>
                          ) : (
                            <dl className="space-y-1.5 text-sm">
                              {e.changes.map((c) => (
                                <div key={c.field} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                                  <dt className="text-neutral-500">{c.label}</dt>
                                  <dd className="min-w-0 break-words">
                                    {e.mode === "diff" ? (
                                      <>
                                        <span className="text-red-700 line-through decoration-red-300">{c.before}</span>
                                        <span className="mx-1.5 text-neutral-400">→</span>
                                        <span className="font-medium text-emerald-700">{c.after}</span>
                                      </>
                                    ) : (
                                      c.after
                                    )}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="mt-4 text-center">
          {limit < MAX_ROWS ? (
            <Link href={hrefWith({ limit: String(limit + PAGE_SIZE) })} scroll={false} className="btn-secondary">
              Xem thêm
            </Link>
          ) : (
            <p className="text-sm text-neutral-500">Đang hiện {MAX_ROWS} thao tác mới nhất — thu hẹp khoảng ngày hoặc bộ lọc để xem thêm.</p>
          )}
        </div>
      )}
    </div>
  );
}
