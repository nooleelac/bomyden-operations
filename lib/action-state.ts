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

export const OFFLINE_MESSAGE = "Mất kết nối mạng — chưa gửi được. Kiểm tra Wi-Fi / 4G rồi bấm lại (thông tin đã nhập vẫn còn).";

/** Lỗi do mất mạng khi gọi server (trình duyệt báo khác nhau: "Failed to fetch", "Load failed", "NetworkError…"). */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

/**
 * Bọc server action phía trình duyệt: mất mạng → trả lỗi dễ hiểu thay vì văng ra màn "Đã có lỗi xảy ra"
 * (giữ nguyên form, người dùng bấm lại khi có mạng). Lỗi khác vẫn ném ra như cũ.
 */
export function withNetworkGuard<S extends ActionState, A extends unknown[]>(
  action: (...args: A) => Promise<S>
): (...args: A) => Promise<S> {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      if (isNetworkError(error)) return fail(OFFLINE_MESSAGE) as S;
      throw error;
    }
  };
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
