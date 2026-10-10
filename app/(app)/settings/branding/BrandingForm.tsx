"use client";

import { useEffect, useState } from "react";
import ActionForm from "@/components/ActionForm";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { COLOR_PRESETS, DEFAULT_BRANDING, HEX_COLOR, readableOn, type Branding } from "@/lib/branding-shared";
import { updateBranding } from "./actions";

const LOGO_MAX_PX = 512;
const LOGO_MAX_BYTES = 1024 * 1024;

/** Thu nhỏ logo (cạnh dài ≤ 512px) và chuyển sang PNG (giữ nền trong suốt); quá 1 MB thì dùng JPG. */
async function prepareLogo(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, LOGO_MAX_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await toBlob("image/png");
  if (blob && blob.size > LOGO_MAX_BYTES) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    blob = await toBlob("image/jpeg", 0.9);
  }
  if (!blob) throw new Error("blob");
  return new File([blob], blob.type === "image/png" ? "logo.png" : "logo.jpg", { type: blob.type });
}

export default function BrandingForm({ branding }: { branding: Branding }) {
  const [brandName, setBrandName] = useState(branding.brandName);
  const [shortName, setShortName] = useState(branding.shortName);
  const [tagline, setTagline] = useState(branding.tagline);
  const [primary, setPrimary] = useState(branding.primaryColor);
  const [header, setHeader] = useState(branding.headerColor);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [state, formAction, pending] = useFormAction(updateBranding);

  // Giải phóng ảnh xem trước khi đổi ảnh / rời trang
  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  const shownLogo = removeLogo ? null : (logoPreview ?? branding.logoUrl);
  const preview: Branding = { ...branding, brandName: brandName || "Tên app", shortName: shortName || "?", tagline, primaryColor: primary, headerColor: header, logoUrl: shownLogo };
  const err = (key: string) => state.fieldErrors?.[key];

  return (
    <ActionForm
      action={(formData) => {
        formData.delete("logo");
        if (logoFile) formData.set("logo", logoFile);
        formAction(formData);
      }}
      className="grid gap-6 lg:grid-cols-[1fr_20rem]"
    >
      <div className="min-w-0 space-y-6">
        <section className="card space-y-4 p-4 sm:p-6">
          <h2 className="font-semibold">Logo</h2>
          <div className="flex items-center gap-4">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50">
              {shownLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shownLogo} alt="Logo" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-neutral-400">Chưa có</span>
              )}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <label className="btn-secondary cursor-pointer">
                {shownLogo ? "Đổi logo" : "Chọn logo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setLogoError("");
                    try {
                      const prepared = await prepareLogo(file);
                      setLogoFile(prepared);
                      setLogoPreview(URL.createObjectURL(prepared));
                      setRemoveLogo(false);
                    } catch {
                      setLogoError("Không đọc được ảnh này. Hãy chọn ảnh PNG hoặc JPG khác.");
                    }
                  }}
                />
              </label>
              {shownLogo && (
                <button
                  type="button"
                  className="ml-2 text-sm font-medium text-red-700 hover:underline"
                  onClick={() => {
                    setLogoFile(null);
                    setLogoPreview(null);
                    setRemoveLogo(true);
                  }}
                >
                  Gỡ logo
                </button>
              )}
              <p className="text-xs text-neutral-500">Nên dùng ảnh vuông, nền trong suốt (PNG). Ảnh được tự thu nhỏ còn 512px.</p>
            </div>
          </div>
          <input type="hidden" name="remove_logo" value={removeLogo ? "1" : ""} />
          {(logoError || err("logo")) && <p className="field-error">{logoError || err("logo")}</p>}
        </section>

        <section className="card space-y-4 p-4 sm:p-6">
          <h2 className="font-semibold">Tên hiển thị</h2>
          <div>
            <label htmlFor="brand_name" className="mb-1.5 block text-sm font-medium text-neutral-700">Tên thương hiệu</label>
            <input id="brand_name" name="brand_name" className="input" maxLength={60} required value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            {err("brand_name") && <p className="field-error">{err("brand_name")}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div>
              <label htmlFor="short_name" className="mb-1.5 block text-sm font-medium text-neutral-700">Chữ viết tắt</label>
              <input id="short_name" name="short_name" className="input" maxLength={6} required value={shortName} onChange={(e) => setShortName(e.target.value)} />
              {err("short_name") && <p className="field-error">{err("short_name")}</p>}
            </div>
            <div>
              <label htmlFor="tagline" className="mb-1.5 block text-sm font-medium text-neutral-700">Khẩu hiệu (trang đăng nhập)</label>
              <input id="tagline" name="tagline" className="input" maxLength={80} value={tagline} onChange={(e) => setTagline(e.target.value)} />
              {err("tagline") && <p className="field-error">{err("tagline")}</p>}
            </div>
          </div>
          <p className="text-xs text-neutral-500">Chữ viết tắt hiện thay logo khi chưa tải logo lên, và trên biểu tượng thông báo.</p>
        </section>

        <section className="card space-y-5 p-4 sm:p-6">
          <h2 className="font-semibold">Màu sắc</h2>
          <ColorField
            name="primary_color"
            label="Màu chủ đạo"
            hint="Nút bấm chính, mục đang chọn, thanh tiến độ."
            value={primary}
            onChange={setPrimary}
            error={err("primary_color")}
          />
          <ColorField
            name="header_color"
            label="Màu thanh tiêu đề"
            hint="Thanh trên cùng của app và thanh trạng thái điện thoại."
            value={header}
            onChange={setHeader}
            error={err("header_color")}
            extra={[{ name: "Trắng", value: "#ffffff" }]}
          />
          <button
            type="button"
            className="text-sm font-medium text-neutral-500 hover:text-neutral-900"
            onClick={() => {
              setPrimary(DEFAULT_BRANDING.primaryColor);
              setHeader(DEFAULT_BRANDING.headerColor);
            }}
          >
            ↺ Về màu mặc định
          </button>
        </section>

        {state.message && <p className={state.ok ? "alert-success" : "alert-error"}>{state.message}</p>}

        <div className="flex justify-end">
          <SubmitButton pending={pending} pendingText="Đang lưu..." className="w-full sm:w-auto">
            Lưu thương hiệu
          </SubmitButton>
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Xem trước</h2>
        <BrandPreview b={preview} />
      </aside>
    </ActionForm>
  );
}

function ColorField({
  name,
  label,
  hint,
  value,
  onChange,
  error,
  extra = [],
}: {
  name: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  extra?: { name: string; value: string }[];
}) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value);
  }
  const options = [...COLOR_PRESETS, ...extra];
  return (
    <fieldset>
      <legend className="text-sm font-medium text-neutral-700">{label}</legend>
      <p className="mb-3 text-xs text-neutral-500">{hint}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((c) => {
          const on = c.value === value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              title={c.name}
              aria-label={c.name}
              onClick={() => onChange(c.value)}
              className={`flex h-9 w-9 items-center justify-center rounded-full border border-black/10 transition ${on ? "ring-2 ring-neutral-900 ring-offset-2" : "hover:scale-110"}`}
              style={{ background: c.value, color: readableOn(c.value) }}
            >
              {on && (
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                  <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <label className="relative h-10 w-12 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-neutral-300" style={{ background: value }}>
          <span className="sr-only">Chọn màu tùy ý</span>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
        <input
          name={name}
          className="input max-w-36 font-mono uppercase"
          value={text}
          maxLength={7}
          spellCheck={false}
          autoCapitalize="none"
          aria-label={`${label} (mã màu)`}
          onChange={(e) => {
            const v = e.target.value.trim().toLowerCase();
            setText(v);
            const hex = v.startsWith("#") ? v : `#${v}`;
            if (HEX_COLOR.test(hex)) onChange(hex);
          }}
          onBlur={() => setText(value)}
        />
      </div>
      {error && <p className="field-error">{error}</p>}
    </fieldset>
  );
}

/** Mô phỏng app trên điện thoại với màu & logo đang chọn. */
function BrandPreview({ b }: { b: Branding }) {
  const headerFg = readableOn(b.headerColor);
  const brandFg = readableOn(b.primaryColor);
  const mark = b.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={b.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg bg-white object-contain" />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-black" style={{ background: b.primaryColor, color: brandFg, boxShadow: `0 0 0 1px ${headerFg}26` }}>
      {b.shortName}
    </span>
  );
  return (
    <div className="mx-auto w-full max-w-[20rem] overflow-hidden rounded-[2rem] border-[6px] border-neutral-800 bg-neutral-100 shadow-xl">
      <div className="flex items-center gap-2 px-3 py-3" style={{ background: b.headerColor, color: headerFg }}>
        {mark}
        <span className="truncate text-sm font-bold">{b.brandName}</span>
      </div>
      <div className="space-y-3 p-3">
        <div className="flex gap-1.5">
          <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: b.primaryColor, color: brandFg }}>Chi nhánh 1</span>
          <span className="rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700">Chi nhánh 2</span>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <p className="text-[11px] font-medium uppercase text-neutral-500">Checklist hôm nay</p>
          <p className="mt-1 text-xl font-bold">8/12</p>
          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <span className="block h-full w-2/3 rounded-full" style={{ background: b.primaryColor }} />
          </span>
        </div>
        <span className="block rounded-lg py-2.5 text-center text-sm font-semibold" style={{ background: b.primaryColor, color: brandFg }}>Nút chính</span>
      </div>
      <div className="flex border-t border-neutral-200 bg-white py-2 text-[10px] font-medium text-neutral-500">
        {["Trang chủ", "Chấm công", "Checklist", "Menu"].map((t, i) => (
          <span key={t} className="flex flex-1 flex-col items-center gap-1" style={i === 0 ? { color: b.primaryColor } : undefined}>
            <span className="h-4 w-4 rounded" style={{ background: i === 0 ? b.primaryColor : "#d4d4d4" }} />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
