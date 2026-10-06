// Tạo tài khoản Quản trị viên ĐẦU TIÊN (chỉ chạy được khi hệ thống chưa có Quản trị viên nào).
// Chạy:  npm run admin:create
// Mật khẩu được nhập trực tiếp trong terminal của bạn, không lưu ở đâu cả.

import { createClient } from "@supabase/supabase-js";
import readline from "node:readline";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const phoneDomain = process.env.AUTH_PHONE_EMAIL_DOMAIN || "sdt.bomyden.invalid";

if (!url || !secretKey) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SECRET_KEY trong .env.local");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
const originalWrite = rl._writeToOutput.bind(rl);
rl._writeToOutput = (text) => (muted ? originalWrite("*") : originalWrite(text));

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      if (hidden) {
        muted = false;
        process.stdout.write("\n");
      }
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

function normalizePhone(input) {
  const raw = input.trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  let result = null;
  if (raw.startsWith("+")) result = `+${digits}`;
  else if (digits.startsWith("84") && digits.length === 11) result = `+${digits}`;
  else if (digits.startsWith("0") && digits.length === 10) result = `+84${digits.slice(1)}`;
  return result && /^\+[1-9][0-9]{7,14}$/.test(result) ? result : null;
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

try {
  const { count, error: countError } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin");
  if (countError) throw countError;
  if (count > 0) {
    console.error("Hệ thống đã có Quản trị viên. Hãy đăng nhập và tạo tài khoản trong trang Nhân viên.");
    process.exit(1);
  }

  console.log("=== TẠO QUẢN TRỊ VIÊN ĐẦU TIÊN — BÒ MỸ ĐEN ===\n");
  const fullName = await ask("Họ tên: ");
  const emailInput = (await ask("Email (bỏ trống nếu không có): ")).toLowerCase();
  const phoneInput = await ask("Số điện thoại (bỏ trống nếu không có): ");
  const password = await ask("Mật khẩu (ít nhất 8 ký tự): ", { hidden: true });
  const confirm = await ask("Nhập lại mật khẩu: ", { hidden: true });

  const email = emailInput || null;
  const phone = phoneInput ? normalizePhone(phoneInput) : null;

  if (!fullName) throw new Error("Chưa nhập họ tên.");
  if (!email && !phone) throw new Error("Cần ít nhất email hoặc số điện thoại.");
  if (phoneInput && !phone) throw new Error("Số điện thoại không hợp lệ.");
  if (password.length < 8) throw new Error("Mật khẩu phải có ít nhất 8 ký tự.");
  if (password !== confirm) throw new Error("Mật khẩu nhập lại không khớp.");

  const authEmail = email ?? `${phone.replace(/\D/g, "")}@${phoneDomain}`;

  const { data: created, error: authError } = await supabase.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authError) throw authError;

  const { error: insertError } = await supabase.from("employees").insert({
    auth_user_id: created.user.id,
    full_name: fullName,
    email,
    phone,
    role: "admin",
  });
  if (insertError) {
    await supabase.auth.admin.deleteUser(created.user.id);
    throw insertError;
  }

  console.log(`\n✓ Đã tạo Quản trị viên "${fullName}". Bạn có thể đăng nhập bằng ${email ?? phoneInput}.`);
} catch (error) {
  console.error(`\n✗ Lỗi: ${error.message ?? error}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
