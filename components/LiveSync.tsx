"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/client";
import { liveTablesFor } from "@/lib/realtime-routes";

/**
 * Realtime cho toàn app (đặt 1 lần ở layout):
 *  - Nghe thay đổi của các bảng mà trang đang mở dùng tới (lib/realtime-routes) + thông báo của chính mình.
 *  - Có thay đổi → tải lại dữ liệu trang (router.refresh: giữ nguyên chữ đang gõ, hộp thoại đang mở).
 *  - Supabase áp RLS cho từng người nghe → chỉ nhận thay đổi của dữ liệu mình được xem.
 *  - Mở lại app sau ≥ 15 giây chạy nền → tải lại (kết nối có thể bị ngắt lúc chạy nền).
 */
export default function LiveSync({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const tablesKey = liveTablesFor(pathname).join(",");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = getBrowserClient();
    let cancelled = false;

    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      // Gộp loạt thay đổi liên tiếp (VD nhập phiếu kho nhiều dòng) thành 1 lần tải lại
      timer.current = setTimeout(() => router.refresh(), 700);
    };

    const ch = supabase.channel(`live-${Math.random().toString(36).slice(2)}`);
    ch.on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `employee_id=eq.${employeeId}` }, refresh);
    for (const table of tablesKey ? tablesKey.split(",") : []) {
      if (table === "notifications") continue;
      ch.on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    }

    // Gắn phiên đăng nhập cho kết nối Realtime để RLS biết ai đang nghe
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      ch.subscribe();
    });

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(ch);
    };
  }, [employeeId, tablesKey, router]);

  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 15_000) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  return null;
}
