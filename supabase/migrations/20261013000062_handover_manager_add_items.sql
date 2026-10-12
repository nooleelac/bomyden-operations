-- =====================================================================
-- BÀN GIAO CA: QUẢN LÝ CŨNG THÊM / SỬA MÓN (13/10/2026)
-- =====================================================================
-- Bỏ giới hạn "chỉ QTV" trong trigger. Quyền vẫn do RLS handover_items: QTV mọi chi nhánh,
-- QL chi nhánh mình (private.manages_branch); nhân viên không sửa được.
-- =====================================================================

create or replace function private.handover_items_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.unit := btrim(new.unit);
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, private.current_employee_id());
  else
    new.branch_id := old.branch_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := private.current_employee_id();
  return new;
end;
$$;
