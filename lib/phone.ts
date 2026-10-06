// Chuẩn hóa số điện thoại về E.164 (ví dụ: 0901 234 567 → +84901234567).

const E164 = /^\+[1-9][0-9]{7,14}$/;

export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  let result: string;
  if (hasPlus) {
    result = `+${digits}`;
  } else if (digits.startsWith("84") && digits.length === 11) {
    result = `+${digits}`;
  } else if (digits.startsWith("0") && digits.length === 10) {
    result = `+84${digits.slice(1)}`;
  } else {
    return null;
  }

  return E164.test(result) ? result : null;
}

/** Hiển thị: +84901234567 → 0901 234 567 */
export function formatPhone(phone: string | null): string {
  if (!phone) return "";
  if (phone.startsWith("+84") && phone.length === 12) {
    const local = `0${phone.slice(3)}`;
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  }
  return phone;
}

/** Email nội bộ cho tài khoản chỉ có số điện thoại (không bao giờ gửi mail tới). */
export function phoneLoginEmail(phone: string): string {
  const domain = process.env.AUTH_PHONE_EMAIL_DOMAIN || "sdt.bomyden.invalid";
  return `${phone.replace(/\D/g, "")}@${domain}`;
}
