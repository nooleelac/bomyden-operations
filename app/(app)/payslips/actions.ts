"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireEmployee } from "@/lib/auth/session";
import { fail, friendlyDbError, success, zodFieldErrors, type ActionState } from "@/lib/action-state";

function revalidateAdvances() {
  revalidatePath("/payslips");
  revalidatePath("/payroll", "layout");
}

const advanceSchema = z.object({
  amount: z
    .string()
    .trim()
    .transform((v) => v.replace(/[.,\s]/g, ""))
    .pipe(
      z
        .string()
        .regex(/^\d{1,12}$/, { message: "Vui lòng nhập số tiền hợp lệ." })
        .transform(Number)
        .pipe(z.number().min(1000, { message: "Số tiền tối thiểu 1.000đ." }))
    ),
  reason: z.string().trim().max(300, { message: "Lý do tối đa 300 ký tự." }),
});

export async function requestAdvance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireEmployee();
  const parsed = advanceSchema.safeParse({
    amount: String(formData.get("amount") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return fail("Vui lòng kiểm tra lại thông tin.", zodFieldErrors(parsed.error.issues));

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_salary_advance", {
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason || null,
  });
  if (error) return fail(friendlyDbError(error));

  revalidateAdvances();
  return success("Đã gửi đơn ứng lương. Bạn sẽ nhận thông báo khi đơn được duyệt.");
}

export async function cancelAdvance(advanceId: string): Promise<ActionState> {
  await requireEmployee();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_salary_advance", { p_id: advanceId });
  if (error) return fail(friendlyDbError(error));

  revalidateAdvances();
  return success("Đã hủy đơn ứng lương.");
}
