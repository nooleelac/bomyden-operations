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

## Chức vụ

| Mã | Tên | Quản lý nhân viên |
|---|---|---|
| `admin` | Quản trị viên | Toàn quyền. Là người duy nhất tạo/sửa được Quản trị viên |
| `manager` | Quản lý | Tạo/sửa/khóa mọi chức vụ trừ Quản trị viên |
| `head_chef`, `staff`, `server`, `cashier` | Bếp chính, Nhân viên, Phục vụ, Thu ngân | Chỉ xem thông tin của mình |

## Cài đặt

1. `npm install`
2. Sao chép `.env.example` → `.env.local`, điền URL, publishable key, secret key của project Supabase.
3. Áp dụng migration trong `supabase/migrations/` lên project.
4. Tạo Quản trị viên đầu tiên: `npm run admin:create`
5. `npm run dev` → http://localhost:3000

## Kiểm tra

```
npm run typecheck
npm run lint
npm run build
```
