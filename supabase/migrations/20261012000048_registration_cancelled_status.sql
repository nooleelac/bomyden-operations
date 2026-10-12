-- Trạng thái "Đã hủy" cho đăng ký ca (giá trị enum mới phải commit trước khi dùng → migration riêng)
alter type public.registration_status add value if not exists 'cancelled';
