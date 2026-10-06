"use client";

import { ROLE_LABELS } from "@/lib/auth/roles";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/constants";
import type { EmployeeRole } from "@/lib/database.types";

export type EmployeeFormDefaults = {
  full_name: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  default_start_time: string;
  sort_order: number;
};

type Props = {
  defaults: EmployeeFormDefaults;
  roles: EmployeeRole[];
  fieldErrors?: Record<string, string>;
  withPassword?: boolean;
  roleLocked?: boolean;
  idPrefix: string;
};

export default function EmployeeFormFields({
  defaults,
  roles,
  fieldErrors,
  withPassword = false,
  roleLocked = false,
  idPrefix,
}: Props) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const error = (name: string) =>
    fieldErrors?.[name] ? <p className="field-error">{fieldErrors[name]}</p> : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor={id("full_name")} className="mb-1.5 block text-sm font-medium text-neutral-700">
          Họ tên <span className="text-red-600">*</span>
        </label>
        <input
          id={id("full_name")}
          name="full_name"
          defaultValue={defaults.full_name}
          required
          maxLength={120}
          autoComplete="off"
          className="input"
        />
        {error("full_name")}
      </div>

      <div>
        <label htmlFor={id("phone")} className="mb-1.5 block text-sm font-medium text-neutral-700">
          Số điện thoại
        </label>
        <input
          id={id("phone")}
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={defaults.phone}
          placeholder="0901234567"
          autoComplete="off"
          className="input"
        />
        {error("phone")}
      </div>

      <div>
        <label htmlFor={id("email")} className="mb-1.5 block text-sm font-medium text-neutral-700">
          Email
        </label>
        <input
          id={id("email")}
          name="email"
          type="email"
          defaultValue={defaults.email}
          placeholder="ten@gmail.com"
          autoComplete="off"
          autoCapitalize="none"
          className="input"
        />
        {error("email")}
      </div>

      <p className="-mt-2 text-xs text-neutral-500 sm:col-span-2">
        Nhập ít nhất một trong hai. Nhân viên đăng nhập được bằng cả email và số điện thoại.
      </p>

      <div>
        <label htmlFor={id("role")} className="mb-1.5 block text-sm font-medium text-neutral-700">
          Chức vụ <span className="text-red-600">*</span>
        </label>
        {roleLocked ? (
          <>
            <input type="hidden" name="role" value={defaults.role} />
            <input id={id("role")} value={ROLE_LABELS[defaults.role]} disabled className="input" />
          </>
        ) : (
          <select id={id("role")} name="role" defaultValue={defaults.role} className="input">
            {roles.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        )}
        {error("role")}
      </div>

      <div>
        <label
          htmlFor={id("default_start_time")}
          className="mb-1.5 block text-sm font-medium text-neutral-700"
        >
          Giờ vào ca mặc định
        </label>
        <input
          id={id("default_start_time")}
          name="default_start_time"
          type="time"
          defaultValue={defaults.default_start_time}
          className="input"
        />
        {error("default_start_time")}
      </div>

      <div>
        <label htmlFor={id("sort_order")} className="mb-1.5 block text-sm font-medium text-neutral-700">
          Thứ tự hiển thị
        </label>
        <input
          id={id("sort_order")}
          name="sort_order"
          type="number"
          inputMode="numeric"
          min={0}
          max={9999}
          defaultValue={defaults.sort_order}
          className="input"
        />
        {error("sort_order")}
      </div>

      {withPassword && (
        <div>
          <label htmlFor={id("password")} className="mb-1.5 block text-sm font-medium text-neutral-700">
            Mật khẩu ban đầu <span className="text-red-600">*</span>
          </label>
          <input
            id={id("password")}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            className="input"
          />
          <p className="mt-1 text-xs text-neutral-500">Ít nhất {PASSWORD_MIN_LENGTH} ký tự.</p>
          {error("password")}
        </div>
      )}
    </div>
  );
}
