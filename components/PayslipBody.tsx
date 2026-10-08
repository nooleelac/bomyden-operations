import { PAY_TYPE_LABELS, formatHours, formatMoney, type PayslipData, type PayslipLine } from "@/lib/payroll";

type Props = {
  data: PayslipData;
  /** Nút thao tác cạnh từng dòng (vd: xóa khoản điều chỉnh) */
  lineAction?: (line: PayslipLine) => React.ReactNode;
};

function LineRow({ line, action }: { line: PayslipLine; action?: React.ReactNode }) {
  const negative = line.amount < 0;
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 text-sm">
        <p className="font-medium">{line.label}</p>
        {(line.quantity !== undefined || line.detail) && (
          <p className="mt-0.5 text-xs text-neutral-500">
            {line.quantity !== undefined && line.unit_amount !== undefined && (
              <span className="tabular-nums">
                {line.quantity} × {formatMoney(line.unit_amount)}
                {line.detail ? " · " : ""}
              </span>
            )}
            {line.detail}
          </p>
        )}
        {action}
      </div>
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${negative ? "text-red-700" : "text-neutral-900"}`}>
        {negative ? "−" : "+"}
        {formatMoney(Math.abs(line.amount))}
      </span>
    </li>
  );
}

export default function PayslipBody({ data, lineAction }: Props) {
  const earnings = data.lines.filter((l) => l.amount >= 0);
  const deductions = data.lines.filter((l) => l.amount < 0);
  const rounding = data.net_amount - data.raw_net_amount;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Kiểu lương", value: PAY_TYPE_LABELS[data.pay_type] },
          { label: "Ngày công", value: `${data.work_days} ngày` },
          { label: "Giờ công", value: formatHours(data.worked_minutes) },
          { label: "Số ca · đi trễ", value: `${data.shifts} ca · ${data.late_count} lần` },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-neutral-200 bg-white px-3 py-2">
            <p className="text-xs text-neutral-500">{s.label}</p>
            <p className="text-sm font-semibold">{s.value}</p>
          </div>
        ))}
      </div>

      <section className="card px-4 py-2">
        <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Thu nhập</h3>
        {earnings.length === 0 ? (
          <p className="py-3 text-sm text-neutral-500">Chưa có khoản thu nhập.</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {earnings.map((line, i) => (
              <LineRow key={`${line.code}-${line.adjustment_id ?? i}`} line={line} action={lineAction?.(line)} />
            ))}
          </ul>
        )}
      </section>

      {deductions.length > 0 && (
        <section className="card px-4 py-2">
          <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-red-700">Khấu trừ</h3>
          <ul className="divide-y divide-neutral-100">
            {deductions.map((line, i) => (
              <LineRow key={`${line.code}-${line.adjustment_id ?? i}`} line={line} action={lineAction?.(line)} />
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-1.5 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-500">Tổng thu nhập</span>
          <span className="tabular-nums">{formatMoney(data.gross_amount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Tổng khấu trừ</span>
          <span className="tabular-nums text-red-700">−{formatMoney(data.deductions_amount)}</span>
        </div>
        {rounding !== 0 && (
          <div className="flex justify-between text-xs text-neutral-400">
            <span>Làm tròn đến 1.000đ</span>
            <span className="tabular-nums">
              {rounding > 0 ? "+" : "−"}
              {formatMoney(Math.abs(rounding))}
            </span>
          </div>
        )}
        <div className="flex justify-between border-t border-neutral-200 pt-2 text-base font-bold">
          <span>Thực nhận</span>
          <span className="tabular-nums">{formatMoney(data.net_amount)}</span>
        </div>
      </section>
    </div>
  );
}
