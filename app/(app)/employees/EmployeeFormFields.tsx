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
  requires_attendance: boolean;
  branch_ids: string[];
};

export type BranchOption = { id: string; name: string };

type Props = {
  defaults: EmployeeFormDefaults;
  roles: EmployeeRole[];
  /** Chi nhánh người thao tác được phép gán */
  branches: BranchOption[];
  /** Chi nhánh của nhân viên nằm ngoài phạm vi người thao tác (chỉ hiển thị, không sửa) */
  otherBranchNames?: string[];
  /** Chỉ Quản trị viên được bật/tắt "phải chấm công" */
  canToggleAttendance: boolean;
  fieldErrors?: Record<string, string>;
  withPassword?: boolean;
  roleLocked?: boolean;
  idPrefix: string;
};

export default function EmployeeFormFields({
  defaults,
  roles,
  branches,
  otherBranchNames = [],
  canToggleAttendance,
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

      {/* CHI NHÁNH */}
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 block text-sm font-medium text-neutral-700">
          Chi nhánh làm việc {defaults.role !== "admin" && <span className="text-red-600">*</span>}
        </legend>
        {branches.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Chưa có chi nhánh nào bạn được quản lý. Quản trị viên cần tạo chi nhánh và gán bạn vào trước.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {branches.map((branch) => (
              <label
                key={branch.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-brand-fg"
              >
                <input
                  type="checkbox"
                  name="branch_ids"
                  value={branch.id}
                  defaultChecked={defaults.branch_ids.includes(branch.id)}
                  className="h-4 w-4 accent-white"
                />
                {branch.name}
              </label>
            ))}
          </div>
        )}
        {otherBranchNames.length > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Còn thuộc chi nhánh ngoài phạm vi của bạn (giữ nguyên): {otherBranchNames.join(", ")}
          </p>
        )}
        {error("branch_ids")}
      </fieldset>

      {/* PHẢI CHẤM CÔNG */}
      {canToggleAttendance ? (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 sm:col-span-2">
          <input
            type="checkbox"
            name="requires_attendance"
            defaultChecked={defaults.requires_attendance}
            className="mt-0.5 h-4 w-4 accent-brand"
          />
          <span>
            <span className="block text-sm font-medium">Phải chấm công</span>
            <span className="block text-xs text-neutral-500">
              Bỏ chọn nếu người này không cần chấm công (ví dụ: Quản lý không trực ca). Quản trị viên luôn không chấm công.
            </span>
          </span>
        </label>
      ) : (
        <p className="text-xs text-neutral-500 sm:col-span-2">
          Chấm công: {defaults.requires_attendance ? "bắt buộc" : "không cần"} (chỉ Quản trị viên được thay đổi).
        </p>
      )}
    </div>
  );
}
