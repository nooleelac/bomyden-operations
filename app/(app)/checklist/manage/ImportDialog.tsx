"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import Dialog from "@/components/Dialog";
import { importTemplatesFromExcel, type ImportState } from "./actions";
import type { BranchStaff } from "./TemplateDialog";

type Props = {
  branches: BranchStaff[];
  /** Chi nhánh đang lọc (chọn sẵn) */
  defaultBranchId?: string;
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
};

const label = "mb-1.5 block text-sm font-medium text-neutral-700";

/** Nhập mẫu công việc hàng loạt từ Excel: tải file mẫu → điền → kiểm tra → nhập */
export default function ImportDialog({ branches, defaultBranchId, open, onClose, onDone }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [branchId, setBranchId] = useState(defaultBranchId ?? (branches.length === 1 ? branches[0].id : ""));
  // Đổi file / chi nhánh → ẩn kết quả kiểm tra cũ
  const [stale, setStale] = useState(true);
  const [state, action, pending] = useActionState(async (prev: ImportState, formData: FormData) => {
    const result = await importTemplatesFromExcel(prev, formData);
    if (result.ok) onDone(result.message);
    return result;
  }, { ok: false, message: "" } as ImportState);

  const submit = (mode: "check" | "import") => {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const data = new FormData(form);
    data.set("mode", mode);
    setStale(false);
    startTransition(() => action(data));
  };

  const show = !stale && !pending;
  const canImport = show && state.checked && !state.errors?.length;
  const fileLink = (existing: boolean) => `/checklist/manage/excel?branch=${branchId}${existing ? "&existing=1" : ""}`;

  return (
    <Dialog open={open} onClose={onClose} title="Nhập công việc từ Excel" description="Tạo nhiều mẫu công việc một lần">
      <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div>
          <label htmlFor="im-branch" className={label}>Chi nhánh</label>
          <select
            id="im-branch"
            name="branch_id"
            required
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setStale(true);
            }}
            className="input"
          >
            <option value="">— Chọn chi nhánh —</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        <ol className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          <li>
            <b>1.</b> Tải file mẫu (có sẵn ô chọn nhân viên, nhóm, bộ việc…):
            <span className="mt-1.5 flex flex-wrap gap-2">
              {branchId ? (
                <>
                  <a href={fileLink(false)} className="btn-secondary px-3 py-1.5 text-xs">⬇ File mẫu trống</a>
                  <a href={fileLink(true)} className="btn-secondary px-3 py-1.5 text-xs">⬇ Kèm công việc hiện có</a>
                </>
              ) : (
                <span className="text-xs text-neutral-500">Chọn chi nhánh trước.</span>
              )}
            </span>
          </li>
          <li><b>2.</b> Điền mỗi dòng 1 công việc (xem sheet &quot;Hướng dẫn&quot; trong file).</li>
          <li><b>3.</b> Tải file lên → <b>Kiểm tra</b> → <b>Nhập</b>. Có lỗi thì không dòng nào được nhập.</li>
        </ol>
        <p className="text-xs text-neutral-500">
          Mẹo: &quot;Kèm công việc hiện có&quot; của chi nhánh A, sửa tên nhân viên rồi nhập vào chi nhánh B để chép cả danh sách. Nhập luôn
          tạo công việc MỚI, không sửa công việc đã có.
        </p>

        <div>
          <label htmlFor="im-file" className={label}>File Excel (.xlsx)</label>
          <input
            id="im-file"
            name="file"
            type="file"
            required
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={() => setStale(true)}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
          />
        </div>

        {show && state.message && (
          <p role={state.errors?.length ? "alert" : "status"} className={state.errors?.length || !state.checked ? "alert-error" : "alert-success"}>
            {state.message}
          </p>
        )}

        {show && state.errors && state.errors.length > 0 && (
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {state.errors.map((e, i) => (
              <li key={i}>{e.line > 0 ? <b>Dòng {e.line}: </b> : null}{e.message}</li>
            ))}
          </ul>
        )}

        {show && state.checked && state.preview && state.preview.length > 0 && (
          <div className="max-h-64 overflow-auto rounded-xl border border-neutral-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-neutral-100 text-neutral-600">
                <tr>
                  <th className="px-2 py-1.5">Dòng</th>
                  <th className="px-2 py-1.5">Công việc</th>
                  <th className="px-2 py-1.5">Giờ</th>
                  <th className="px-2 py-1.5">Lặp</th>
                  <th className="px-2 py-1.5">Giao cho</th>
                  <th className="px-2 py-1.5">Bộ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {state.preview.map((r) => (
                  <tr key={r.line}>
                    <td className="px-2 py-1.5 text-neutral-400">{r.line}</td>
                    <td className="px-2 py-1.5 font-medium">{r.title}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{r.time}</td>
                    <td className="px-2 py-1.5">{r.schedule}</td>
                    <td className="px-2 py-1.5">{r.assignee}</td>
                    <td className="px-2 py-1.5">{r.setName ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">Hủy</button>
          {canImport ? (
            <button type="button" onClick={() => submit("import")} disabled={pending} className="btn-primary">
              {pending ? "Đang nhập..." : `Nhập ${state.preview?.length ?? 0} công việc`}
            </button>
          ) : (
            <button type="button" onClick={() => submit("check")} disabled={pending} className="btn-primary">
              {pending ? "Đang kiểm tra..." : "Kiểm tra file"}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
