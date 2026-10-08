// Cài đặt thông báo đẩy (chạy 1 lần cho mỗi project Supabase):
//   - Tạo cặp khóa VAPID (Web Push), mã bí mật cho cron, URL Edge Function "ops-jobs"
//   - Lưu vào Supabase Vault (qua hàm service_set_secret, cần SUPABASE_SECRET_KEY)
//   - Ghi NEXT_PUBLIC_VAPID_PUBLIC_KEY vào .env.local
// Dùng: npm run push:setup            (giữ khóa cũ nếu đã có)
//       npm run push:setup -- --rotate (tạo khóa mới — mọi thiết bị phải bật lại thông báo)
import { createClient } from "@supabase/supabase-js";
import { createECDH, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SECRET_KEY (chạy qua: npm run push:setup).");
  process.exit(1);
}

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const rotate = process.argv.includes("--rotate");

const { data: current, error: readError } = await admin.rpc("service_ops_config");
if (readError) throw readError;

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const set = async (name, value) => {
  const { error } = await admin.rpc("service_set_secret", { p_name: name, p_value: value });
  if (error) throw error;
};

let publicKey = current?.vapid_public_key;
if (!publicKey || !current?.vapid_private_key || rotate) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  publicKey = b64url(ecdh.getPublicKey()); // 65 byte, dạng không nén
  await set("vapid_public_key", publicKey);
  await set("vapid_private_key", b64url(ecdh.getPrivateKey()));
  console.log(rotate ? "Đã tạo khóa VAPID mới." : "Đã tạo khóa VAPID.");
} else {
  console.log("Giữ nguyên khóa VAPID đã có.");
}
if (!current?.cron_secret || rotate) await set("ops_cron_secret", b64url(randomBytes(32)));
await set("vapid_subject", url);
await set("ops_jobs_url", `${url}/functions/v1/ops-jobs`);

// Ghi khóa công khai vào .env.local
const envPath = new URL("../.env.local", import.meta.url);
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const line = `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}`;
env = /^NEXT_PUBLIC_VAPID_PUBLIC_KEY=.*$/m.test(env)
  ? env.replace(/^NEXT_PUBLIC_VAPID_PUBLIC_KEY=.*$/m, line)
  : `${env.replace(/\s*$/, "")}\n${line}\n`;
writeFileSync(envPath, env);
console.log("Đã ghi NEXT_PUBLIC_VAPID_PUBLIC_KEY vào .env.local. Khi deploy, thêm biến này vào môi trường hosting.");
