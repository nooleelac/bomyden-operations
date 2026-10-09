// Edge Function "ops-jobs" — chỉ pg_cron (qua pg_net) gọi, xác thực bằng header x-cron-secret.
//   job = "reminders": gửi Web Push cho các thông báo đang chờ (bảng notifications).
//   job = "cleanup":   xóa ảnh checklist cũ hơn 3 tháng khỏi kho task-photos (giữ dòng lịch sử);
//                      xóa ảnh hóa đơn bỏ dở > 1 ngày và ảnh phiếu nhập > 12 tháng khỏi kho invoice-photos.
// Deploy với verify_jwt = false (tự xác thực trong code).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEY = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")["default"] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PHOTO_BUCKET = "task-photos";
const INVOICE_BUCKET = "invoice-photos";

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

type Config = { vapid_public_key: string | null; vapid_private_key: string | null; vapid_subject: string | null; cron_secret: string | null };
type Pending = {
  id: string;
  title: string;
  body: string;
  url: string;
  kind: string;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function sendReminders(cfg: Config) {
  if (!cfg.vapid_public_key || !cfg.vapid_private_key || !cfg.vapid_subject) throw new Error("Thiếu khóa VAPID");
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public_key, cfg.vapid_private_key);

  let sent = 0;
  let failed = 0;
  const dead: string[] = [];
  for (let round = 0; round < 5; round++) {
    const { data, error } = await admin.rpc("service_pending_pushes", { p_limit: 100 });
    if (error) throw error;
    const items = (data ?? []) as Pending[];
    if (items.length === 0) break;

    await Promise.all(
      items.flatMap((n) =>
        n.subscriptions.map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.id }),
              { TTL: 60 * 60, urgency: "high" },
            );
            sent++;
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            // Thiết bị đã gỡ đăng ký / hết hạn → xóa
            if (status === 404 || status === 410) dead.push(s.endpoint);
            else failed++;
            console.error("push lỗi", status, (err as Error).message);
          }
        })
      ),
    );

    const { error: finishError } = await admin.rpc("service_finish_pushes", {
      p_ids: items.map((n) => n.id),
      p_dead_endpoints: dead.splice(0),
    });
    if (finishError) throw finishError;
    if (items.length < 100) break;
  }
  return { sent, failed };
}

async function purge(bucket: string, listFn: string, markFn: string) {
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await admin.rpc(listFn, { p_limit: 500 });
    if (error) throw error;
    const rows = (data ?? []) as { id: string; photo_path: string }[];
    if (rows.length === 0) break;

    const { error: removeError } = await admin.storage.from(bucket).remove(rows.map((r) => r.photo_path));
    if (removeError) throw removeError;

    const { error: markError } = await admin.rpc(markFn, { p_ids: rows.map((r) => r.id) });
    if (markError) throw markError;
    removed += rows.length;
    if (rows.length < 500) break;
  }
  return removed;
}

async function cleanupPhotos() {
  const removed = await purge(PHOTO_BUCKET, "service_photos_to_purge", "service_mark_photos_purged");
  const invoices = await purge(INVOICE_BUCKET, "service_invoice_photos_to_purge", "service_mark_invoice_photos_purged");
  return { removed, invoices };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const { data: cfg, error } = await admin.rpc("service_ops_config");
  if (error || !cfg) return json({ error: "Không đọc được cấu hình" }, 500);
  const config = cfg as Config;
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!config.cron_secret || !safeEqual(provided, config.cron_secret)) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  try {
    if (body.job === "reminders") return json(await sendReminders(config));
    if (body.job === "cleanup") return json(await cleanupPhotos());
    return json({ error: "Job không hợp lệ" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: (err as Error).message }, 500);
  }
});
