import "server-only";

import { isIP } from "node:net";
import { headers } from "next/headers";

/**
 * IP công khai của người dùng, do máy chủ tự đọc (người dùng không tự khai được).
 * Khi deploy (Vercel / proxy), IP thật nằm ở phần tử đầu tiên của x-forwarded-for.
 */
export async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0];
  const raw = (forwarded ?? h.get("x-real-ip") ?? "").trim();
  return normalizeIp(raw);
}

export function normalizeIp(value: string): string | null {
  const ip = value.trim().replace(/^::ffff:/i, "");
  return isIP(ip) ? ip : null;
}
