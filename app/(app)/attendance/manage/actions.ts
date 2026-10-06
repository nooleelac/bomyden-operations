"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth/session";
import { fromLocalInput } from "@/lib/time";
import { fail, friendlyDbError, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

function revalidateAttendance() {
  revalidatePath("/attendance");
  revalidatePath("/attendance/manage");
}

const localDateTime = (label: string) =>
  z.string().transform((value, ctx) => {
    const iso = fromLocalInput(value);
    if (!iso) {
      ctx.addIssue({ code: "custom", message: `${label} không hợp lệ.` });
      return z.NEVER;
    }
    return iso;
  });

const timesSchema = z
  .object({
    check_in: localDateTime("Giờ vào"),
    check_out: localDateTime("Giờ ra"),
  })
  .refine((value) => new Date(value.check_out) > new Date(value.check_in), {
    path: ["check_out"],
    message: "Giờ ra phải sau giờ vào.",
  });

const reasonField = z
  .string()
  .trim()
  .min(3, { message: "Vui lòng nhập lý do (ít nhất 3 ký tự)." })
  .max(500, { message: "Lý do tối đa 500 ký tự." });

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "");

// =====================================================================
// DUYỆT / TỪ CHỐI YÊU CẦU SỬA
// =====================================================================
export async function reviewCorrection(
  correctionId: string,
  approve: boolean,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireManager();
  const note = str(formData, "note").trim().slice(0, 500);

  let times: { check_in: string; check_out: string } | null = null;
  if (approve) {
    const parsed = timesSchema.safeParse({ check_in: str(formData, "check_in"), check_out: str(formData, "check_out") });
    if (!parsed.success) {
      return fail("Vui lòng kiểm tra lại giờ.", zodFieldErrors(parsed.error.issues));
    }
    times = parsed.data;
  } else if (note.length < 3) {
    return fail("Vui lòng ghi lý do từ chối.", { note: "Nhập lý do từ chối." });
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_attendance_correction", {
    p_correction_id: correctionId,
    p_approve: approve,
    p_check_in_at: times?.check_in,
    p_check_out_at: times?.check_out,
    p_note: note || undefined,
  });
  if (error) return fail(friendlyDbError(error));

  revalidateAttendance();
  return success(approve ? "Đã duyệt và cập nhật giờ chấm công." : "Đã từ chối yêu cầu.");
}

// =====================================================================
// SỬA TRỰC TIẾP MỘT CA
// =====================================================================
export async function correctRecord(
  recordId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireManager();

  const parsed = timesSchema
    .and(z.object({ reason: reasonField }))
    .safeParse({
      check_in: str(formData, "check_in"),
      check_out: str(formData, "check_out"),
      reason: str(formData, "reason"),
    });
  if (!parsed.success) {
    return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_attendance", {
    p_attendance_id: recordId,
    p_check_in_at: parsed.data.check_in,
    p_check_out_at: parsed.data.check_out,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(friendlyDbError(error));

  revalidateAttendance();
  return success("Đã sửa giờ chấm công.");
}

// =====================================================================
// THÊM CA THỦ CÔNG (nhân viên quên vào ca)
// =====================================================================
const manualSchema = z.object({
  employee_id: z.uuid({ message: "Vui lòng chọn nhân viên." }),
  branch_id: z.uuid({ message: "Vui lòng chọn chi nhánh." }),
  reason: reasonField,
});

export async function addManualRecord(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireManager();

  const parsed = manualSchema.safeParse({
    employee_id: str(formData, "employee_id"),
    branch_id: str(formData, "branch_id"),
    reason: str(formData, "reason"),
  });
  const parsedTimes = timesSchema.safeParse({ check_in: str(formData, "check_in"), check_out: str(formData, "check_out") });
  if (!parsed.success || !parsedTimes.success) {
    return fail(
      "Vui lòng kiểm tra lại thông tin.",
      zodFieldErrors([...(parsed.error?.issues ?? []), ...(parsedTimes.error?.issues ?? [])])
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_manual_attendance", {
    p_employee_id: parsed.data.employee_id,
    p_branch_id: parsed.data.branch_id,
    p_check_in_at: parsedTimes.data.check_in,
    p_check_out_at: parsedTimes.data.check_out,
    p_reason: parsed.data.reason,
  });
  if (error) return fail(friendlyDbError(error));

  revalidateAttendance();
  return success("Đã thêm ca làm.");
}
