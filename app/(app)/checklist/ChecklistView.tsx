"use client";

import { useCallback, useEffect, useState } from "react";
import TaskCard, { type TaskCardData } from "./TaskCard";

type Props = {
  mine: TaskCardData[];
  covering: TaskCardData[];
};

function Section({ title, tasks, onDone, empty }: { title: string; tasks: TaskCardData[]; onDone: (m: string) => void; empty?: string }) {
  if (tasks.length === 0 && !empty) return null;
  return (
    <section className="mt-6">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {tasks.length === 0 ? (
        <div className="card px-6 py-8 text-center text-sm text-neutral-500">{empty}</div>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onDone={onDone} />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ChecklistView({ mine, covering }: Props) {
  const [toast, setToast] = useState("");
  const notify = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const isOpen = (t: TaskCardData) => ["upcoming", "open", "overdue"].includes(t.displayStatus);
  const todo = mine.filter(isOpen);
  const finished = mine.filter((t) => !isOpen(t));

  return (
    <>
      <Section title={`Cần làm (${todo.length})`} tasks={todo} onDone={notify} empty="Bạn đã làm xong mọi việc hôm nay. 🎉" />
      <Section title={`Làm thay (${covering.length})`} tasks={covering} onDone={notify} />
      <Section title={`Đã xong (${finished.length})`} tasks={finished} onDone={notify} />

      {toast && (
        <p role="status" className="alert-success fixed inset-x-4 bottom-[calc(var(--nav-h)+1rem)] z-50 shadow-lg sm:left-auto sm:right-6 sm:w-96">
          {toast}
        </p>
      )}
    </>
  );
}
