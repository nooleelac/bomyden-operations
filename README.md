# BÒ MỸ ĐEN — Hệ thống vận hành

Next.js 16 (App Router) · TypeScript · Supabase (Postgres, Auth, RLS) · Tailwind CSS v4

## Nguyên tắc kiến trúc

- **Một cơ chế phiên duy nhất**: Supabase Auth qua cookie (`@supabase/ssr`). Không dùng localStorage.
- **`employees.id` là khóa nghiệp vụ**; `auth.users.id` chỉ nằm ở `employees.auth_user_id`.
- **DB là nguồn sự thật**: RLS trên mọi bảng, trigger chặn leo thang quyền, không xóa nhân viên (chỉ khóa), audit log tự động.
- **Server-first**: dữ liệu đọc ở Server Component, ghi qua Server Action; mọi action tự kiểm tra quyền.
- **Secret key chỉ ở server** (`lib/supabase/admin.ts`, có `import "server-only"`).
- Schema quản lý bằng migration trong `supabase/migrations/`.

## Cấu trúc

```
app/
  login/                 đăng nhập (email hoặc số điện thoại)
  auth/signout/          đăng xuất phía server
  (app)/                 khu vực cần đăng nhập
    page.tsx             trang chủ
    account/             tài khoản của tôi, đổi mật khẩu
    employees/           quản lý nhân viên (Quản trị viên, Quản lý)
    inventory/           kho: tồn kho, nhập kho từ ảnh hóa đơn, phiếu nhập, nguyên liệu, nhà cung cấp
components/              UI dùng chung
lib/
  auth/roles.ts          chức vụ & quyền (nguồn duy nhất phía app)
  auth/session.ts        getCurrentEmployee / requireEmployee / requireManager
  supabase/              client theo phiên (server) & client quản trị (admin)
  validation/            schema zod
supabase/migrations/     schema DB
scripts/                 tiện ích (tạo Quản trị viên đầu tiên)
proxy.ts                 làm mới phiên + chuyển hướng khi chưa đăng nhập
```

## Chức vụ & phạm vi

| Mã | Tên | Nhân viên | Chấm công | Chi nhánh |
|---|---|---|---|---|
| `admin` | Quản trị viên | Toàn quyền; duy nhất tạo/sửa Quản trị viên; bật/tắt "phải chấm công" | Không chấm công; xem/duyệt/sửa mọi chi nhánh | Tạo/sửa |
| `manager` | Quản lý | Tạo/sửa/khóa nhân viên **cùng chi nhánh** (trừ Quản trị viên) | Chấm công nếu được bật; xem/duyệt/sửa trong chi nhánh mình (không tự duyệt cho mình) | Chỉ xem |
| `head_chef`, `staff`, `server`, `cashier` | Bếp chính, Nhân viên, Phục vụ, Thu ngân | Chỉ xem của mình | Vào/ra ca, gửi yêu cầu sửa | — |

## Chấm công

- Hợp lệ khi **IP Wi-Fi chi nhánh** hoặc **GPS trong bán kính** (sai số GPS ≤ 200 m). Giờ lấy từ máy chủ.
- Vào/ra ca chạy qua server (`attendance_check_in/out` chỉ `service_role` gọi được) → người dùng không giả được IP.
- Tối đa 1 ca mở/người; DB chặn ca chồng thời gian. Ca mở > 16 giờ = "quên ra ca" → phải gửi yêu cầu sửa.
- Mọi sửa đổi ghi `audit_logs` kèm người sửa và lý do. Không xóa bản ghi chấm công.
- Lưu ý: GPS do điện thoại gửi nên có thể bị giả bởi người rành công nghệ; IP Wi-Fi khó giả hơn.

## Checklist

- **Mẫu công việc** (`task_templates`) theo chi nhánh: giờ bắt đầu/hạn chót, lặp hằng ngày / theo thứ / theo ngày trong tháng
  (ngày 29–31 không có trong tháng → chạy ngày cuối tháng), 1 người chính + 1 người thay thế, bắt buộc ảnh/ghi chú tùy mẫu.
- **Việc theo ngày** (`task_instances`) sinh tự động, idempotent (`ensure_task_instances`, unique theo mẫu + ngày):
  cron `bomyden-ensure-tasks` mỗi 10 phút + ngay khi tạo/sửa/giao/nhập mẫu (trang không gọi lúc mở để tải nhanh).
  Nội dung được "chụp" lúc sinh; sửa mẫu chỉ áp dụng cho việc chưa làm từ hôm nay.
- **Đánh dấu** qua server (`complete_task_instance` chỉ `service_role` gọi): người chính, hoặc người thay thế khi người chính
  không chấm công hôm đó; phải đang trong ca tại chi nhánh của việc. "Không đạt" luôn cần lý do.
- **Ảnh** thu nhỏ trên điện thoại (≤1600px JPEG) → kho riêng tư `task-photos`, chỉ xem qua link ký tạm thời 2 giờ
  (cache theo từng ảnh tối đa 1 giờ → trang tự cập nhật không làm tải lại ảnh).
- **Nhật ký cron** (`cron.job_run_details`) chỉ giữ 7 ngày (cron `bomyden-cron-history-cleanup`, 03:30).
- **Quản lý**: báo cáo theo ngày (quá hạn / không đạt / cần làm / xong / xong trễ), yêu cầu làm lại kèm lý do.

## Bảng lương

- **Hồ sơ lương** từng NV: theo giờ / theo ca / cố định (÷ ngày công chuẩn × ngày đi làm, tối đa = lương), kỳ tuần (T2–CN)
  hoặc tháng, tăng ca (giờ vượt chuẩn mỗi ngày), phụ cấp cố định/kỳ & theo ngày công, mức phạt riêng (ghi đè mức chung).
- **Tự tính** từ chấm công (chỉ ca đã ra ca) + checklist: phạt trễ (lần vào ca đầu ngày > giờ vào ca mặc định + ân hạn),
  "Không đạt" & làm trễ (người đánh dấu), không làm (người chính, hoặc người thay thế nếu người chính nghỉ).
- **Nhập tay**: KPI, thưởng, phụ cấp khác, khoản trừ, truy lĩnh/truy thu — bắt buộc lý do.
- **Chốt** (`finalize_payslip`): chỉ khi kỳ đã kết thúc, không còn ca chưa ra / yêu cầu sửa chờ duyệt. Phiếu lưu ảnh chụp
  `payslips.data`, khóa cứng (không sửa/xóa). Tính đến từng đồng, làm tròn thực nhận đến 1.000đ.
- **Quyền**: QTV; Quản lý được QTV bật `can_manage_payroll` → NV chi nhánh mình (không gồm mình & Quản lý khác);
  NV xem phiếu đã chốt khi QTV bật `can_view_payslip`. Một công thức duy nhất trong DB (`private.compute_payslip`).
- **Kiểm thử tự động**: `npm run test:payroll` (thêm `-- --all` để in mọi phép kiểm) — 14 tình huống / 58 phép kiểm
  (theo giờ, tăng ca, theo ca, cố định, nghỉ có lương, trễ, về sớm, nghỉ không phép, checklist, điều chỉnh, ứng lương,
  chốt sớm, chặn chốt). Chạy trên DB thật nhưng dữ liệu thử bị hủy ngay (`public.service_run_payroll_tests`, chỉ secret key).
  **Sửa công thức lương → luôn chạy lại**; đổi quy tắc tính có chủ đích → cập nhật số mong đợi trong
  `private.payroll_test_suite` (migration mới).

## Lịch làm việc & đơn xin phép

- **Mẫu ca** (`shift_templates`) và **ca** (`shifts`) theo chi nhánh; ca qua đêm được (tối đa 16 giờ); DB chặn ca trùng giờ của
  cùng một người. QTV + Quản lý (chi nhánh mình) xếp lịch, sao chép tuần trước (`copy_week_shifts`, bỏ qua ca trùng).
- **Nháp → Công bố** (`publish_week_shifts`): nhân viên chỉ thấy ca đã công bố (cả chi nhánh mình, qua `branch_week_schedule`).
  Ca đã công bố không xóa, không đổi ngày giờ — chỉ đổi người/ghi chú hoặc **hủy kèm lý do** (đơn đang chờ của ca đó tự hủy).
- **Đơn**: nghỉ (theo ngày), đi trễ, về sớm (giờ dự kiến), đổi/nhường ca (người nhận đồng ý → Quản lý duyệt; duyệt thì ca
  được chuyển ngay, DB kiểm tra trùng giờ). Gửi sát hơn hạn báo trước → **Gấp**; vượt số lần/tháng → **Vượt giới hạn**
  (vẫn gửi được). QTV cài hạn/giới hạn. Không ai tự duyệt đơn liên quan đến mình. Chỉ QTV đánh dấu **nghỉ có lương**.
- **Nối vào lương** (`compute_payslip`): đi trễ so với ca đầu ngày theo lịch (trễ có phép → mốc = giờ đã xin; không có lịch →
  giờ vào ca mặc định); về sớm so với ca cuối ngày (có ân hạn); nghỉ không phép = ca đã kết thúc mà không chấm công và không có
  đơn nghỉ đã duyệt (chỉ NV phải chấm công); ngày nghỉ có lương = 1 ngày công cho lương cố định. Đơn chờ duyệt trong kỳ chặn chốt.
- Chấm công vẫn tự do, không bắt buộc có ca.

## Thông báo & tự dọn ảnh

- **Thông báo đẩy (Web Push)** — hiện cả khi app đóng / màn hình tắt. Người dùng bấm "Bật thông báo" (trang chủ, Tài khoản
  hoặc Thông báo). iPhone (iOS 16.4+): phải mở bằng Safari → Chia sẻ → "Thêm vào MH chính" rồi bật trong app. Cần HTTPS
  (chạy thật sau khi deploy; localhost dùng để thử trên máy tính).
- **Nhắc checklist**: trước hạn chót 30 phút → người phụ trách (người chính; + người thay thế nếu người chính chưa chấm công).
  Quá hạn → người phụ trách + Quản lý chi nhánh + Quản trị viên. Mỗi loại chỉ báo 1 lần/việc; chuông 🔔 trên đầu trang
  lưu thông báo 60 ngày.
- **Cách chạy**: `pg_cron` mỗi phút gọi `private.run_task_reminders()` (ghi bảng `notifications`) → nếu có tin cần đẩy thì
  gọi Edge Function `ops-jobs` (`supabase/functions/ops-jobs`) qua `pg_net`. Edge Function gửi Web Push, tự gỡ thiết bị hết hạn.
- **Tự dọn ảnh checklist**: 03:00 hằng đêm xóa ảnh cũ hơn **3 tháng** khỏi kho `task-photos` (giữ dòng lịch sử, đánh dấu
  `photo_purged_at`; báo cáo hiện "Ảnh đã dọn").
- **Cài đặt 1 lần cho mỗi project**: deploy Edge Function `ops-jobs` (verify_jwt = false, tự kiểm tra `x-cron-secret`),
  rồi chạy `npm run push:setup` — tạo khóa VAPID + mã cron, lưu vào Supabase Vault, ghi `NEXT_PUBLIC_VAPID_PUBLIC_KEY` vào
  `.env.local` (khi deploy nhớ thêm biến này vào hosting). `-- --rotate` để đổi khóa (mọi thiết bị phải bật lại).

## Kho (nhập kho từ ảnh hóa đơn)

- **Quyền**: QTV (mọi chi nhánh), Quản lý (chi nhánh mình), nhân viên khác khi QTV bật `can_receive_stock` (Kho → Quyền).
  Nhân viên chỉ nhập phiếu + xem tồn/phiếu; QTV/QL sửa danh mục, nhà cung cấp, hủy phiếu, điều chỉnh tồn.
- **Luồng**: chụp ảnh → thu nhỏ trên điện thoại (≤2000px) → server tải lên kho riêng tư `invoice-photos` → Claude
  (`lib/invoice-ai.ts`, mặc định `claude-haiku-5-5`, đổi bằng `INVOICE_AI_MODEL`) trả JSON có cấu trúc →
  khớp tên hàng (bộ nhớ theo NCC trước, rồi gợi ý của AI) → người dùng xem lại, sửa → `create_stock_receipt` (1 giao dịch).
- **Đơn vị**: mỗi nguyên liệu 1 đơn vị kho + đơn vị quy đổi (1 thùng = 10 kg). Quy đổi mới và "tên trên hóa đơn → nguyên liệu"
  được ghi nhớ khi lưu phiếu (`inventory_item_units`, `inventory_aliases`).
- **Tồn kho** = sổ phát sinh `stock_movements` + số dư `stock_balances` (chưa có xuất kho; QTV/QL "điều chỉnh" kèm lý do).
- Phiếu đã lưu không sửa; sai thì QTV/QL **hủy** (trừ lại tồn) rồi nhập lại. Cùng NCC + cùng số hóa đơn → từ chối nhập trùng.
- **VAT theo từng dòng** (0/5/8/10%…): thành tiền dòng = chưa VAT, tiền thuế = thành tiền × thuế suất (làm tròn đồng).
  AI không đọc được thuế suất từng dòng → app suy ra từ tổng tiền thuế (`inferLineVatRates`). Ngày bị đọc kiểu Mỹ → tự đảo.
- Giá vốn (lịch sử giá, cảnh báo giá lệch ≥ 10%, giá trị tồn) tính **sau VAT**.
- **Công nợ**: lúc lưu chọn đã trả đủ / một phần / chưa trả (+ hình thức, hạn; hạn mặc định = ngày HĐ + số ngày nợ của NCC).
  `supplier_payments` (trả nhiều lần, không xóa, chỉ hủy kèm lý do) do QTV/QL ghi; `stock_receipts.debt_amount` tự tính.
  Hủy phiếu → tự hủy các lần thanh toán. Trang Kho → Công nợ: nợ từng NCC, quá hạn, đã trả trong tháng.
- Mỗi lượt quét ghi `invoice_scans` (token → chi phí ước tính ở Kho → Quyền); tối đa 50 lượt/người/ngày.
- Ảnh quét bỏ dở xóa sau 1 ngày; ảnh phiếu nhập giữ 12 tháng (job `cleanup` của Edge Function `ops-jobs`).
- Không có `ANTHROPIC_API_KEY` → vẫn nhập tay được (ảnh vẫn lưu kèm phiếu).

## Xuất Excel

Route handler trả file .xlsx (`lib/excel.ts`, thư viện `exceljs`), đọc dữ liệu bằng phiên người dùng nên RLS tự giới hạn phạm vi:

| Nút ở trang | Đường dẫn | Ai | Nội dung |
|---|---|---|---|
| Kho | `/inventory/export/stock` | Có quyền kho | Tồn từng chi nhánh, giá gần nhất, giá trị tồn |
| Phiếu nhập | `/inventory/export/receipts?month=&branch=` | Có quyền kho | Phiếu, chi tiết hàng (VAT, giá vốn), thanh toán |
| Công nợ | `/inventory/export/debts` | QTV / QL | Nợ theo NCC, phiếu còn nợ, số ngày quá hạn |
| Quản lý chấm công | `/attendance/manage/export?month=&branch=` | QTV / QL | Tổng hợp công theo NV + chi tiết vào/ra |
| Bảng lương | `/payroll/export?period=&start=` | Quyền lương | Bảng lương kỳ (giống màn hình) + chi tiết các khoản |

## Dọn dữ liệu thử (an toàn)

Không dùng `session_replication_role = replica` (làm mồ côi bảng `auth.*`). Tắt riêng trigger chặn xóa trong giao dịch,
và xóa tài khoản đăng nhập qua Supabase Auth Admin API (`deleteUser`).

## Cài đặt

1. `npm install`
2. Sao chép `.env.example` → `.env.local`, điền URL, publishable key, secret key của project Supabase.
3. Áp dụng migration trong `supabase/migrations/` lên project.
4. Tạo Quản trị viên đầu tiên: `npm run admin:create`
5. Thông báo đẩy: deploy Edge Function `supabase/functions/ops-jobs`, rồi `npm run push:setup`
6. `npm run dev` → http://localhost:3000

## Kiểm tra

```
npm run typecheck
npm run lint
npm run build
```

## Kiểm kê & xuất kho

- **Kiểm kê** (khi cần): đếm tồn thực tế (đơn vị kho hoặc đơn vị phụ) → tồn đặt bằng số đếm. Lượng **đã dùng** = tồn sổ − tồn đếm
  (sổ = lần đếm trước + nhập − xuất). Không hiện tồn sổ lúc đếm; nháp lưu trên máy. Phiếu kiểm kê không hủy được.
- **Phiếu xuất**: hủy hàng / chuyển chi nhánh (cộng tồn bên nhận) / khác — bắt buộc lý do; QTV/QL chi nhánh xuất được hủy phiếu.
- Quyền kiểm kê / xuất: QTV, QL chi nhánh, NV được bật "nhập kho". Báo cáo **Tiêu hao** theo tháng: QTV/QL.
- **Mức tối thiểu** theo chi nhánh: dưới mức → Tổng quan + lọc trên trang Kho + thông báo 9:00 hằng ngày (pg_cron `bomyden-low-stock`).
- Giá vốn = giá nhập gần nhất sau VAT, chụp lại lúc lập phiếu.
- **Nhắc công nợ NCC** 9:00 hằng ngày (pg_cron `bomyden-debt-reminder`): còn 3 ngày, đúng ngày đến hạn, quá hạn nhắc mỗi ngày đến khi trả xong — gộp 1 thông báo / chi nhánh cho QL + QTV.
