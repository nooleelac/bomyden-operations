"use client";

import { useEffect } from "react";
import { markAllNotificationsRead } from "./actions";

/** Mở trang thông báo = đã xem: đánh dấu đã đọc (lần hiển thị này vẫn tô các tin mới). */
export default function MarkReadOnView() {
  useEffect(() => {
    void markAllNotificationsRead();
  }, []);
  return null;
}
