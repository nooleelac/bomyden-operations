// Kiểm thử tự động công thức lương (private.compute_payslip) trên DB thật.
// Dữ liệu thử được tạo rồi HỦY ngay trong DB (xem migration 20261011000045_payroll_tests.sql) → không ảnh hưởng dữ liệu thật.
// Dùng: npm run test:payroll          (chỉ in phép kiểm trượt + tổng kết)
//       npm run test:payroll -- --all (in mọi phép kiểm)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SECRET_KEY (chạy qua: npm run test:payroll).");
  process.exit(1);
}

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const showAll = process.argv.includes("--all");

const { data: results, error } = await admin.rpc("service_run_payroll_tests");
if (error) {
  console.error("Không chạy được bộ test:", error.message);
  process.exit(1);
}

let lastCase = "";
for (const r of results) {
  if (!showAll && r.ok) continue;
  if (r.case !== lastCase) {
    console.log(`\n${r.case}`);
    lastCase = r.case;
  }
  console.log(r.ok ? `  ✓ ${r.check}` : `  ✗ ${r.check}: ra ${r.actual ?? "(trống)"}, mong đợi ${r.expected ?? "(không lỗi)"}`);
}

const failed = results.filter((r) => !r.ok).length;
const cases = new Set(results.map((r) => r.case)).size;
console.log(
  failed === 0
    ? `\n✅ Công thức lương ĐÚNG: ${results.length}/${results.length} phép kiểm, ${cases} tình huống.`
    : `\n❌ ${failed}/${results.length} phép kiểm SAI — xem chi tiết ở trên.`
);
process.exit(failed === 0 ? 0 : 1);
