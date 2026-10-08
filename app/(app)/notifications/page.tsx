import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/time";
import PushToggle from "@/components/PushToggle";
import MarkReadOnView from "./MarkReadOnView";

export const metadata: Metadata = { title: "Thông báo" };
export const instant = false;

export default async function NotificationsPage() {
  const me = await requireEmployee();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, url, created_at, read_at")
    .eq("employee_id", me.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Không tải được thông báo.");
  const unread = data.filter((n) => !n.read_at).length;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">← Trang chủ</Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold tracking-tight">Thông báo</h1>

      {data.length === 0 ? (
        <div className="card px-6 py-10 text-center text-sm text-neutral-500">Chưa có thông báo nào.</div>
      ) : (
        <ul className="card divide-y divide-neutral-100">
          {data.map((n) => (
            <li key={n.id}>
              <Link href={n.url} className={`block p-4 text-sm hover:bg-neutral-50 ${n.read_at ? "" : "bg-sky-50/60"}`}>
                <p className={n.read_at ? "font-medium" : "font-semibold"}>
                  {!n.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-sky-600 align-middle" aria-label="Chưa đọc" />}
                  {n.title}
                </p>
                <p className="mt-0.5 text-neutral-600">{n.body}</p>
                <p className="mt-0.5 text-xs text-neutral-400">{formatDateTime(n.created_at)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-neutral-400">Thông báo được giữ 60 ngày.</p>

      <PushToggle />
      {unread > 0 && <MarkReadOnView />}
    </div>
  );
}
