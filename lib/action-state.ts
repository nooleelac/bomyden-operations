// Kiểu trả về chung cho server action dùng với useActionState.

export type ActionState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  /** Tăng mỗi lần thành công để client biết đóng hộp thoại / reset form. */
  successKey?: number;
};

export const initialActionState: ActionState = { ok: false, message: "" };

export function fail(message: string, fieldErrors?: Record<string, string>): ActionState {
  return { ok: false, message, fieldErrors };
}

export function success(message: string): ActionState {
  return { ok: true, message, successKey: Date.now() };
}

/** Gom lỗi zod thành { field: message } (lấy lỗi đầu tiên của mỗi field). */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/** Dịch lỗi Postgres/Supabase sang tiếng Việt cho người dùng. */
export function friendlyDbError(error: { code?: string; message?: string } | null): string {
  if (!error) return "Đã có lỗi xảy ra.";
  if (error.code === "23505") {
    if (error.message?.includes("email")) return "Email này đã được dùng cho nhân viên khác.";
    if (error.message?.includes("phone")) return "Số điện thoại này đã được dùng cho nhân viên khác.";
    if (error.message?.includes("task_templates_no_duplicate")) return "Không giao trùng việc: nhân viên đã có công việc cùng tên ở chi nhánh này.";
    return "Dữ liệu bị trùng.";
  }
  if (error.code === "42501") {
    // RLS chặn (thông báo tiếng Anh của Postgres) hoặc trigger nghiệp vụ (đã là tiếng Việt)
    if (!error.message || error.message.includes("row-level security")) {
      return "Bạn không có quyền thực hiện thao tác này.";
    }
    return error.message;
  }
  // Lỗi nghiệp vụ do hàm DB trả về (thông báo đã là tiếng Việt)
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "23P01") return "Thời gian bị trùng với một ca khác.";
  if (error.code === "23514") return "Dữ liệu không hợp lệ.";
  return "Không thể lưu dữ liệu. Vui lòng thử lại.";
}
