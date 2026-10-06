"use client";

import { useRef, useState } from "react";
import { getCurrentPosition } from "@/components/geolocation";

export type BranchFormDefaults = {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  radius_m: number;
  wifi_ips: string;
  is_active?: boolean;
};

type Props = {
  idPrefix: string;
  defaults: BranchFormDefaults;
  fieldErrors?: Record<string, string>;
  currentIp: string | null;
  showActive?: boolean;
};

export default function BranchFormFields({ idPrefix, defaults, fieldErrors, currentIp, showActive }: Props) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const latRef = useRef<HTMLInputElement>(null);
  const lngRef = useRef<HTMLInputElement>(null);
  const ipsRef = useRef<HTMLTextAreaElement>(null);
  const [geoMessage, setGeoMessage] = useState("");
  const [locating, setLocating] = useState(false);

  const error = (name: string) =>
    fieldErrors?.[name] ? <p className="field-error">{fieldErrors[name]}</p> : null;

  async function useCurrentLocation() {
    setLocating(true);
    setGeoMessage("");
    const result = await getCurrentPosition();
    setLocating(false);
    if (!result.ok) {
      setGeoMessage(result.message);
      return;
    }
    if (latRef.current) latRef.current.value = result.lat.toFixed(6);
    if (lngRef.current) lngRef.current.value = result.lng.toFixed(6);
    setGeoMessage(`Đã lấy vị trí (sai số khoảng ${Math.round(result.accuracy)} m).`);
  }

  function addCurrentIp() {
    if (!currentIp || !ipsRef.current) return;
    const lines = ipsRef.current.value.split(/\s+/).filter(Boolean);
    if (!lines.includes(currentIp)) {
      ipsRef.current.value = [...lines, currentIp].join("\n");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={id("name")} className="mb-1.5 block text-sm font-medium text-neutral-700">
          Tên chi nhánh <span className="text-red-600">*</span>
        </label>
        <input id={id("name")} name="name" defaultValue={defaults.name} required maxLength={100} className="input" />
        {error("name")}
      </div>

      <div>
        <label htmlFor={id("address")} className="mb-1.5 block text-sm font-medium text-neutral-700">
          Địa chỉ
        </label>
        <input id={id("address")} name="address" defaultValue={defaults.address} maxLength={255} className="input" />
        {error("address")}
      </div>

      <fieldset className="rounded-xl border border-neutral-200 p-4">
        <legend className="px-1 text-sm font-semibold">Vị trí GPS</legend>
        <p className="mb-3 text-xs text-neutral-500">
          Đứng tại quán rồi bấm “Lấy vị trí hiện tại” để điền tự động.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={id("latitude")} className="mb-1.5 block text-xs font-medium text-neutral-600">
              Vĩ độ
            </label>
            <input
              ref={latRef}
              id={id("latitude")}
              name="latitude"
              inputMode="decimal"
              defaultValue={defaults.latitude}
              placeholder="10.776900"
              className="input"
            />
          </div>
          <div>
            <label htmlFor={id("longitude")} className="mb-1.5 block text-xs font-medium text-neutral-600">
              Kinh độ
            </label>
            <input
              ref={lngRef}
              id={id("longitude")}
              name="longitude"
              inputMode="decimal"
              defaultValue={defaults.longitude}
              placeholder="106.700900"
              className="input"
            />
          </div>
        </div>
        {error("latitude")}
        {error("longitude")}
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={locating}
          className="btn-secondary mt-3 w-full"
        >
          {locating ? "Đang lấy vị trí..." : "📍 Lấy vị trí hiện tại"}
        </button>
        {geoMessage && <p className="mt-2 text-xs text-neutral-600">{geoMessage}</p>}

        <div className="mt-4">
          <label htmlFor={id("radius_m")} className="mb-1.5 block text-xs font-medium text-neutral-600">
            Bán kính cho phép chấm công (mét)
          </label>
          <input
            id={id("radius_m")}
            name="radius_m"
            type="number"
            inputMode="numeric"
            min={20}
            max={2000}
            defaultValue={defaults.radius_m}
            required
            className="input"
          />
          {error("radius_m")}
        </div>
      </fieldset>

      <fieldset className="rounded-xl border border-neutral-200 p-4">
        <legend className="px-1 text-sm font-semibold">Wi-Fi của quán</legend>
        <p className="mb-3 text-xs text-neutral-500">
          IP công khai của mạng Wi-Fi quán, mỗi dòng một IP. Nhân viên kết nối Wi-Fi này sẽ chấm công được kể cả khi GPS
          kém.
        </p>
        <textarea
          ref={ipsRef}
          id={id("wifi_ips")}
          name="wifi_ips"
          rows={3}
          defaultValue={defaults.wifi_ips}
          placeholder="113.161.xx.xx"
          className="input font-mono"
        />
        {error("wifi_ips")}
        {currentIp && (
          <button type="button" onClick={addCurrentIp} className="btn-secondary mt-3 w-full">
            ➕ Thêm IP mạng đang dùng ({currentIp})
          </button>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          Chỉ bấm khi bạn đang kết nối đúng Wi-Fi của chi nhánh này.
        </p>
      </fieldset>

      {showActive && (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
          <input type="checkbox" name="is_active" defaultChecked={defaults.is_active} className="h-4 w-4 accent-neutral-900" />
          <span className="text-sm font-medium">Chi nhánh đang hoạt động</span>
        </label>
      )}
    </div>
  );
}
