"use client";

import { useActionState } from "react";
import { initialActionState, type ActionState } from "@/lib/action-state";

/**
 * useActionState + callback khi server action thành công
 * (đóng hộp thoại, reset form, hiện thông báo...) mà không cần useEffect.
 */
export function useFormAction(
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>,
  onSuccess?: (result: ActionState) => void
) {
  return useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok) onSuccess?.(result);
    return result;
  }, initialActionState);
}
