import WeekView from "./WeekView";
import type { WeekSchedule } from "@/lib/schedule";

type Props = {
  myId: string;
  today: string;
  weekStart: string;
  data: WeekSchedule | null;
};

export default function ScheduleView({ myId, today, weekStart, data }: Props) {
  return data ? (
    <WeekView weekStart={weekStart} today={today} data={data} myId={myId} />
  ) : (
    <div className="card p-6 text-center text-sm text-neutral-500">Bạn chưa được gán chi nhánh nào.</div>
  );
}
