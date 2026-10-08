"use client";

import { useState } from "react";
import ActionForm from "@/components/ActionForm";
import Dialog from "@/components/Dialog";
import SubmitButton from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { createRequest } from "./actions";
import { REQUEST_KIND_LABELS, dayLabel } from "@/lib/schedule";
import type { ActionState } from "@/lib/action-state";
import type { RequestKind } from "@/lib/database.types";

export type UpcomingShift = {
  id: string;
  branchId: string;
  branchName: string;
  employeeId: string;
  workDate: string;
  startTime: string;
  endTime: string;
};

type Props = {
  myId: string;
  today: string;
  /** Ca sắp tới (đã công bố) ở các chi nhánh của tôi, gồm cả của đồng nghiệp */
  upcoming: UpcomingShift[];
  colleagues: Record<string, { id: string; name: string }[]>;
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
};

function Err({ state, name }: { state: ActionState; name: string }) {
  return state.fieldErrors?.[name] ? <p className="field-error">{state.fieldErrors[name]}</p> : null;
}

const shiftOption = (s: UpcomingShift, withBranch: boolean) =>
  `${dayLabel(s.workDate)} · ${s.startTime}–${s.endTime}${withBranch ? ` · ${s.branchName}` : ""}`;

export default function RequestDialog({ myId, today, upcoming, colleagues, open, onClose, onDone }: Props) {
  const [kind, setKind] = useState<RequestKind>("leave");
  const [shiftId, setShiftId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [state, action, pending] = useFormAction(createRequest, (r) => onDone(r.message));

  const myShifts = upcoming.filter((s) => s.employeeId === myId);
  const multiBranch = new Set(myShifts.map((s) => s.branchId)).size > 1;
  const selected = myShifts.find((s) => s.id === shiftId);
  const people = selected ? (colleagues[selected.branchId] ?? []).filter((p) => p.id !== myId) : [];
  const targetShifts = selected ? upcoming.filter((s) => s.employeeId === targetId && s.branchId === selected.branchId) : [];
  const label = "mb-1.5 block text-sm font-medium text-neutral-700";

  return (
    <Dialog open={open} onClose={onClose} title="Gửi đơn xin phép">
      <ActionForm action={action} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-sm">
          {(Object.keys(REQUEST_KIND_LABELS) as RequestKind[]).map((k) => (
            <label
              key={k}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-center font-medium ${kind === k ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700"}`}
            >
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              {REQUEST_KIND_LABELS[k]}
            </label>
          ))}
        </div>

        {kind === "leave" ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rq-start" className={label}>Từ ngày</label>
              <input id="rq-start" name="start_date" type="date" min={today} required className="input" />
              <Err state={state} name="start_date" />
            </div>
            <div>
              <label htmlFor="rq-end" className={label}>Đến ngày</label>
              <input id="rq-end" name="end_date" type="date" min={today} className="input" />
              <p className="mt-1 text-xs text-neutral-500">Bỏ trống nếu nghỉ 1 ngày.</p>
              <Err state={state} name="end_date" />
            </div>
            <p className="col-span-2 text-xs text-neutral-500">
              Nghỉ tính theo ngày. Muốn nghỉ 1 ca thì dùng &quot;Đổi / nhường ca&quot;.
            </p>
          </div>
        ) : (
          <div>
            <label htmlFor="rq-shift" className={label}>{kind === "swap" ? "Ca của bạn" : "Ca làm"}</label>
            {myShifts.length === 0 ? (
              <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-500">Bạn chưa có ca nào sắp tới (đã công bố).</p>
            ) : (
              <select
                id="rq-shift"
                name="shift_id"
                required
                value={shiftId}
                onChange={(e) => {
                  setShiftId(e.target.value);
                  setTargetId("");
                }}
                className="input"
              >
                <option value="">— Chọn ca —</option>
                {myShifts.map((s) => <option key={s.id} value={s.id}>{shiftOption(s, multiBranch)}</option>)}
              </select>
            )}
            <Err state={state} name="shift_id" />
          </div>
        )}

        {(kind === "late" || kind === "early_leave") && (
          <div>
            <label htmlFor="rq-time" className={label}>{kind === "late" ? "Giờ dự kiến vào ca" : "Giờ dự kiến về"}</label>
            <input
              id="rq-time"
              name="requested_time"
              type="time"
              required
              defaultValue={kind === "late" ? selected?.startTime : selected?.endTime}
              key={`${kind}-${shiftId}`}
              className="input"
            />
            <p className="mt-1 text-xs text-neutral-500">
              {kind === "late" ? "Đến trước giờ này sẽ không bị tính trễ." : "Ra ca từ giờ này trở đi sẽ không bị tính về sớm."}
            </p>
            <Err state={state} name="requested_time" />
          </div>
        )}

        {kind === "swap" && selected && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rq-target" className={label}>Người nhận</label>
              <select id="rq-target" name="target_employee_id" required value={targetId} onChange={(e) => setTargetId(e.target.value)} className="input">
                <option value="">— Chọn —</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Err state={state} name="target_employee_id" />
            </div>
            <div>
              <label htmlFor="rq-tshift" className={label}>Đổi lấy ca của họ</label>
              <select id="rq-tshift" name="target_shift_id" key={targetId} defaultValue="" className="input" disabled={!targetId}>
                <option value="">Không — chỉ nhường ca</option>
                {targetShifts.map((s) => <option key={s.id} value={s.id}>{shiftOption(s, false)}</option>)}
              </select>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="rq-reason" className={label}>Lý do</label>
          <textarea id="rq-reason" name="reason" rows={3} required maxLength={500} className="input" />
          <Err state={state} name="reason" />
        </div>

        {state.message && !state.ok && <p role="alert" className="alert-error">{state.message}</p>}
        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          <SubmitButton pending={pending} pendingText="Đang gửi...">Gửi đơn</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
