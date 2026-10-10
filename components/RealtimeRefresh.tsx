"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/client";

type Watch = {
  table: "task_instances" | "notifications" | "attendance_records";
  /** Bộ lọc Realtime, VD "task_date=eq.2026-10-10" (RLS vẫn luôn được áp) */
  filter?: string;
};

type Props = {
  /** Tên kênh, duy nhất trong trang */
  channel: string;
  watch: Watch[];
  /** Gộp nhiều thay đổi liên tiếp thành 1 lần tải lại */
  debounceMs?: number;
  /** Tải lại khi mở lại app sau ≥ 15 giây chạy nền (chỉ bật ở 1 chỗ — layout — để không tải trùng) */
  refreshOnResume?: boolean;
};

/**
 * Realtime: khi dữ liệu đang xem thay đổi (người khác đánh dấu việc, vào ca, có thông báo mới...)
 * thì tự tải lại dữ liệu của trang (router.refresh — giữ nguyên trạng thái đang nhập trên trang).
 * refreshOnResume: quay lại tab / mở lại app sau một lúc thì tải lại, vì kết nối có thể bị ngắt lúc chạy nền.
 */
export default function RealtimeRefresh({ channel, watch, debounceMs = 600, refreshOnResume = false }: Props) {
  const router = useRouter();
  const key = JSON.stringify(watch);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = getBrowserClient();
    const items: Watch[] = JSON.parse(key);
    let hiddenAt = 0;
    let cancelled = false;

    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), debounceMs);
    };

    const ch = supabase.channel(`${channel}-${Math.random().toString(36).slice(2)}`);
    for (const w of items) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: w.table, ...(w.filter && { filter: w.filter }) }, refresh);
    }

    // Gắn phiên đăng nhập cho kết nối Realtime để RLS biết ai đang nghe
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      ch.subscribe();
    });

    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 15_000) router.refresh();
    };
    if (refreshOnResume) document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(ch);
    };
  }, [channel, key, debounceMs, refreshOnResume, router]);

  return null;
}
