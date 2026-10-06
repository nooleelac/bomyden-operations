"use client";

import { startTransition, useEffect, useState } from "react";
import { useFormAction } from "@/components/useFormAction";
import { getCurrentPosition } from "@/components/geolocation";
import { clock } from "./actions";
import RequestCorrectionButton from "./RequestCorrectionButton";
import { formatDateTime, formatDuration, formatTime, minutesBetween } from "@/lib/time";

export type OpenShift = {
  id: string;
  check_in_at: string;
  branch_name: string;
  has_pending_correction: boolean;
};

type Props = {
  openShift: OpenShift | null;
  forgotten: boolean;
  branchNames: string[];
};

export default function ClockCard({ openShift, forgotten, branchNames }: Props) {
  const [inState, inAction, inPending] = useFormAction(clock.bind(null, "in"));
  const [outState, outAction, outPending] = useFormAction(clock.bind(null, "out"));
  const [locating, setLocating] = useState(false);
  const [geoNote, setGeoNote] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [lastKind, setLastKind] = useState<"in" | "out" | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const busy = locating || inPending || outPending;
  const state = lastKind === "out" ? outState : inState;

  async function handleClock(kind: "in" | "out") {
    setLastKind(kind);
    setGeoNote("");
    setLocating(true);
    const geo = await getCurrentPosition();
    setLocating(false);

    const formData = new FormData();
    if (geo.ok) {
      formData.set("lat", String(geo.lat));
      formData.set("lng", String(geo.lng));
      formData.set("accuracy", String(geo.accuracy));
    } else {
      setGeoNote(`${geo.message} Hệ thống sẽ thử xác nhận bằng Wi-Fi của quán.`);
    }
    startTransition(() => (kind === "in" ? inAction : outAction)(formData));
  }

  const buttonText = locating ? "Đang lấy vị trí..." : busy ? "Đang xử lý..." : null;

  return (
    <section className="card overflow-hidden">
      <div className={`px-5 py-6 text-center sm:px-8 ${openShift && !forgotten ? "bg-emerald-50" : forgotten ? "bg-red-50" : ""}`}>
        {forgotten && openShift ? (
          <>
            <p className="text-sm font-semibold text-red-700">⚠️ Bạn quên ra ca</p>
            <p className="mt-1 text-sm text-red-700">
              Ca vào lúc <strong>{formatDateTime(openShift.check_in_at)}</strong> tại {openShift.branch_name} chưa được kết thúc.
            </p>
            <p className="mt-3 text-sm text-neutral-600">
              {openShift.has_pending_correction
                ? "Yêu cầu sửa của bạn đang chờ quản lý duyệt."
                : "Hãy gửi yêu cầu sửa giờ ra để quản lý chấm lại, sau đó bạn mới vào ca mới được."}
            </p>
            {!openShift.has_pending_correction && (
              <div className="mt-4 flex justify-center">
                <RequestCorrectionButton
                  attendanceId={openShift.id}
                  checkInAt={openShift.check_in_at}
                  checkOutAt={null}
                  label="Gửi yêu cầu sửa giờ ra"
                  primary
                />
              </div>
            )}
          </>
        ) : openShift ? (
          <>
            <p className="text-sm font-medium text-emerald-700">● Đang trong ca · {openShift.branch_name}</p>
            <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight" suppressHydrationWarning>
              {formatDuration(minutesBetween(openShift.check_in_at, null, now))}
            </p>
            <p className="mt-1 text-sm text-neutral-500">Vào ca lúc {formatTime(openShift.check_in_at)}</p>
            <button
              type="button"
              onClick={() => handleClock("out")}
              disabled={busy}
              className="btn-danger mt-6 w-full max-w-xs py-4 text-base"
            >
              {buttonText ?? "Ra ca"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-neutral-500">Bạn chưa vào ca</p>
            <p className="mt-1 text-xs text-neutral-400">
              {branchNames.length > 0 ? `Chi nhánh: ${branchNames.join(", ")}` : "Bạn chưa được gán chi nhánh."}
            </p>
            <button
              type="button"
              onClick={() => handleClock("in")}
              disabled={busy || branchNames.length === 0}
              className="btn mt-6 w-full max-w-xs bg-emerald-600 py-4 text-base text-white hover:bg-emerald-700"
            >
              {buttonText ?? "Vào ca"}
            </button>
          </>
        )}
      </div>

      {(geoNote || state.message) && (
        <div className="space-y-2 border-t border-neutral-100 px-5 py-4">
          {geoNote && <p className="alert-info">{geoNote}</p>}
          {state.message && (
            <p role="status" className={state.ok ? "alert-success" : "alert-error"}>
              {state.message}
            </p>
          )}
        </div>
      )}

      {!openShift && (
        <p className="border-t border-neutral-100 px-5 py-3 text-center text-xs text-neutral-400">
          Cần bật định vị (GPS) hoặc kết nối Wi-Fi của quán để chấm công.
        </p>
      )}
    </section>
  );
}
