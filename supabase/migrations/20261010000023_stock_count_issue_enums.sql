-- Giá trị enum mới cho kiểm kê / xuất kho / cảnh báo tồn thấp
-- (tách riêng: giá trị enum mới phải commit trước khi dùng)
alter type public.stock_movement_kind add value if not exists 'count';
alter type public.stock_movement_kind add value if not exists 'issue';
alter type public.stock_movement_kind add value if not exists 'issue_cancel';
alter type public.stock_movement_kind add value if not exists 'transfer_in';
alter type public.stock_movement_kind add value if not exists 'transfer_in_cancel';
alter type public.notification_kind add value if not exists 'low_stock';
