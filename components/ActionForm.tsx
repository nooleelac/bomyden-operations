"use client";

import { startTransition } from "react";

type Props = Omit<React.FormHTMLAttributes<HTMLFormElement>, "action" | "onSubmit"> & {
  action: (formData: FormData) => void;
  ref?: React.Ref<HTMLFormElement>;
};

/**
 * Form gọi server action nhưng KHÔNG tự xóa dữ liệu đã nhập khi có lỗi
 * (React 19 mặc định reset form sau mỗi lần submit qua prop `action`).
 * Muốn xóa form sau khi thành công: đổi `key` của form hoặc gọi form.reset().
 */
export default function ActionForm({ action, children, ...props }: Props) {
  return (
    <form
      {...props}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
    >
      {children}
    </form>
  );
}
