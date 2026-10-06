"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireEmployee } from "@/lib/auth/session";
import { mustClockIn } from "@/lib/auth/roles";
import { getClientIp } from "@/lib/request-ip";
import { formatTime, fromLocalInput } from "@/lib/time";
import { fail, friendlyDbError, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

function revalidateAttendance() {
  revalidatePath("/attendance");
  revalidatePath("/attendance/manage");
}

/** Đọc tọa độ GPS do trình duyệt gửi (có thể không có nếu người dùng từ chối định vị). */
function readCoords(formData: FormData) {
  const lat = Number(formData.get("lat"));
  const lng = Number(formData.get("lng"));
  const accuracy = Number(formData.get("accuracy"));
  if (
    !formData.get("lat") ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : undefined };
}

// =====================================================================
// VÀO CA / RA CA
// Máy chủ tự đọc IP thật + xác thực phiên, rồi gọi hàm DB chỉ server được gọi.
// =====================================================================
export async function clock(kind: "in" | "out", _prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireEmployee();
  if (!mustClockIn(me)) return fail("Tài khoản của bạn không cần chấm công.");

  const coords = readCoords(formData);
  const ip = await getClientIp();

  const admin = createAdminClient();
  const args = {
    p_auth_uid: me.auth_user_id,
    p_lat: coords?.lat,
    p_lng: coords?.lng,
    p_accuracy: coords?.accuracy,
    p_ip: ip ?? undefined,
  };
  const { data, error } =
    kind === "in"
      ? await admin.rpc("attendance_check_in", args)
      : await admin.rpc("attendance_check_out", args);

  if (error || !data) return fail(friendlyDbError(error));

  revalidateAttendance();
  if (kind === "in") {
    const via = data.check_in_method === "wifi" ? "Wi-Fi quán" : "GPS";
    return success(`Đã vào ca lúc ${formatTime(data.check_in_at)} (xác nhận qua ${via}).`);
  }
  const via = data.check_out_method === "wifi" ? "Wi-Fi quán" : "GPS";
  return success(`Đã ra ca lúc ${formatTime(data.check_out_at ?? data.updated_at)} (xác nhận qua ${via}).`);
}

// =====================================================================
// YÊU CẦU SỬA CHẤM CÔNG
// =====================================================================
const correctionSchema = z
  .object({
    check_in: z.string().transform((value, ctx) => {
      const iso = fromLocalInput(value);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: "Giờ vào không hợp lệ." });
        return z.NEVER;
      }
      return iso;
    }),
    check_out: z.string().transform((value, ctx) => {
      const iso = fromLocalInput(value);
      if (!iso) {
        ctx.addIssue({ code: "custom", message: "Vui lòng nhập giờ ra." });
        return z.NEVER;
      }
      return iso;
    }),
    reason: z
      .string()
      .trim()
      .min(3, { message: "Vui lòng nhập lý do (ít nhất 3 ký tự)." })
      .max(500, { message: "Lý do tối đa 500 ký tự." }),
  })
  .refine((value) => new Date(value.check_out) > new Date(value.check_in), {
    path: ["check_out"],
    message: "Giờ ra phải sau giờ vào.",
  });

export async function requestCorrection(
  attendanceId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireEmployee();

  const parsed = correctionSchema.safeParse({
    check_in: String(formData.get("check_in") ?? ""),
    check_out: String(formData.get("check_out") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) {
    return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_attendance_correction", {
    p_attendance_id: attendanceId,
    p_check_in_at: parsed.data.check_in,
    p_check_out_at: parsed.data.check_out,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(friendlyDbError(error));

  revalidateAttendance();
  return success("Đã gửi yêu cầu sửa. Quản lý sẽ xem và duyệt.");
}

export async function cancelCorrection(correctionId: string): Promise<ActionState> {
  await requireEmployee();

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_attendance_correction", { p_correction_id: correctionId });
  if (error) return fail(friendlyDbError(error));

  revalidateAttendance();
  return success("Đã hủy yêu cầu.");
}
