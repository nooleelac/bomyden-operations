"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEmployee } from "@/lib/auth/session";
import { TASK_PHOTO_BUCKET, TASK_PHOTO_MAX_BYTES, TASK_PHOTO_TYPES } from "@/lib/task-photos";
import { fail, friendlyDbError, success, type ActionState } from "@/lib/action-state";

/**
 * Đánh dấu Hoàn thành / Không đạt.
 * 1. Đọc công việc bằng phiên người dùng (RLS) → chắc chắn họ được xem việc này.
 * 2. Tải ảnh (nếu có) lên kho riêng tư bằng secret key.
 * 3. Gọi hàm DB (chỉ server gọi được) — hàm kiểm tra quyền, ca làm, ảnh/ghi chú bắt buộc.
 * 4. Hàm DB từ chối → xóa ảnh vừa tải để không để rác.
 */
export async function completeTask(
  instanceId: string,
  status: "done" | "failed",
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const me = await requireEmployee();
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const photo = formData.get("photo");

  const supabase = await createClient();
  const { data: task } = await supabase
    .from("task_instances")
    .select("id, branch_id, task_date, status, requires_photo")
    .eq("id", instanceId)
    .maybeSingle();
  if (!task) return fail("Không tìm thấy công việc.");
  if (task.status !== "pending") return fail("Việc này đã được đánh dấu trước đó.");

  if (status === "failed" && note.length < 3) {
    return fail("Vui lòng ghi lý do không hoàn thành được.", { note: "Ghi lý do (ít nhất 3 ký tự)." });
  }

  let photoPath: string | null = null;
  const admin = createAdminClient();

  if (photo instanceof File && photo.size > 0) {
    if (!TASK_PHOTO_TYPES.includes(photo.type)) {
      return fail("Ảnh phải là JPG, PNG hoặc WEBP.", { photo: "Định dạng ảnh không hợp lệ." });
    }
    if (photo.size > TASK_PHOTO_MAX_BYTES) {
      return fail("Ảnh quá lớn (tối đa 5 MB).", { photo: "Ảnh quá lớn." });
    }
    const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
    photoPath = `${task.branch_id}/${task.task_date}/${task.id}/${randomUUID()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from(TASK_PHOTO_BUCKET)
      .upload(photoPath, Buffer.from(await photo.arrayBuffer()), { contentType: photo.type, upsert: false });
    if (uploadError) return fail("Không tải được ảnh lên. Vui lòng thử lại.");
  } else if (status === "done" && task.requires_photo) {
    return fail("Việc này bắt buộc chụp ảnh.", { photo: "Vui lòng chụp ảnh." });
  }

  const { error } = await admin.rpc("complete_task_instance", {
    p_auth_uid: me.auth_user_id,
    p_instance_id: instanceId,
    p_status: status,
    p_note: note || undefined,
    p_photo_path: photoPath ?? undefined,
  });

  if (error) {
    if (photoPath) await admin.storage.from(TASK_PHOTO_BUCKET).remove([photoPath]);
    return fail(friendlyDbError(error));
  }

  revalidatePath("/checklist");
  revalidatePath("/checklist/manage");
  return success(status === "done" ? "Đã đánh dấu hoàn thành." : "Đã báo không đạt. Quản lý sẽ thấy ngay.");
}
