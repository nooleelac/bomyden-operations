import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Mô hình đọc hóa đơn. Đổi bằng biến môi trường INVOICE_AI_MODEL (vd: claude-sonnet-5-5) mà không cần sửa code.
const DEFAULT_MODEL = "claude-haiku-5-5";

// LƯU Ý giới hạn structured outputs: tối đa 16 trường kiểu "union" (nullable / anyOf) trong toàn schema,
// vượt là API trả 400. Trường nào để trống được bằng "" / 0 / "unknown" thì KHÔNG dùng .nullable().
// Hiện dùng 11 (5 ở phần đầu + 6 ở mỗi dòng hàng).
const InvoiceSchema = z.object({
  is_invoice: z.boolean(),
  supplier_name: z.string().nullable(),
  invoice_number: z.string(),
  invoice_date: z.string().nullable(),
  subtotal: z.number().nullable(),
  vat_amount: z.number().nullable(),
  total_amount: z.number().nullable(),
  payment_status: z.enum(["paid", "unpaid", "partial", "unknown"]),
  paid_amount: z.number(),
  payment_method: z.enum(["cash", "transfer", "other", "unknown"]),
  due_date: z.string(),
  lines: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().nullable(),
      unit: z.string().nullable(),
      unit_price: z.number().nullable(),
      amount: z.number().nullable(),
      vat_rate: z.number().nullable(),
      catalog_no: z.number().int().nullable(),
    })
  ),
  warning: z.string(),
});

export type InvoiceExtraction = z.infer<typeof InvoiceSchema>;

export type CatalogEntry = { no: number; name: string; baseUnit: string; units: string[] };

export type InvoiceAiResult =
  | { ok: true; data: InvoiceExtraction; model: string; inputTokens: number; outputTokens: number }
  | { ok: false; message: string; model: string; inputTokens?: number; outputTokens?: number; detail?: string };

const SYSTEM_PROMPT = `Bạn đọc ảnh chụp hóa đơn / phiếu giao hàng / phiếu bán hàng mua nguyên liệu của một nhà hàng ở Việt Nam.
Ảnh có thể là hóa đơn in, hóa đơn VAT, hoặc phiếu viết tay của chợ / mối hàng; có thể nghiêng, mờ, nhàu.

Quy tắc:
- is_invoice = false nếu ảnh không phải hóa đơn/phiếu mua hàng (khi đó lines để rỗng).
- Mỗi mặt hàng là 1 dòng trong "lines". Bỏ qua dòng tổng cộng, thuế, chiết khấu, phí ship, chữ ký.
- "name": ghi đúng tên hàng như trên hóa đơn (giữ tiếng Việt có dấu, sửa lỗi chính tả rõ ràng của chữ viết tay).
- Số tiền theo kiểu Việt Nam: "1.250.000" hoặc "1,250,000" = 1250000; "1tr2" = 1200000; "250k" = 250000;
  số tiền viết tắt bỏ 3 số 0 (vd cột "Thành tiền" ghi 250 trong khi đơn giá 50 × 5) thì nhân 1000 cho đúng.
- Số lượng có thể lẻ: "2,5" = 2.5; "1/2" = 0.5.
- "unit": đơn vị tính ghi trên hóa đơn (kg, g, thùng, hộp, bao, chai, lon, bó, con, cái...). Không có thì null.
- Kiểm tra chéo số lượng × đơn giá ≈ thành tiền; nếu chỉ có 2 trong 3 giá trị thì tự suy ra giá trị còn lại.
  Không đọc được thì để null, KHÔNG bịa số.
- "invoice_date" dạng YYYY-MM-DD. Hóa đơn Việt Nam ghi ngày kiểu NGÀY/THÁNG/NĂM: "03/10/2026" = 2026-10-03 (ngày 3 tháng 10),
  KHÔNG phải tháng 3. Chỉ hiểu kiểu Mỹ (tháng trước) khi tháng được viết bằng chữ tiếng Anh (vd "Oct 3, 2026").
  Năm viết tắt "26" = 2026. Không có ngày thì null.

VAT (thuế GTGT):
- "amount" của từng dòng là thành tiền CHƯA thuế. Nếu hóa đơn chỉ ghi giá đã gồm thuế (hóa đơn bán lẻ, không tách thuế)
  thì giữ nguyên số đó và vat_rate = 0.
- "vat_rate" của từng dòng: thuế suất % (0, 5, 8, 10...) lấy từ cột "Thuế suất" / "VAT %" của dòng đó.
  Nếu cả hóa đơn chỉ ghi một thuế suất chung thì dùng cho mọi dòng. Hàng "KCT" (không chịu thuế) = 0.
  Nếu hóa đơn có thuế nhưng không ghi rõ thuế suất từng dòng thì để null (app sẽ tự suy ra).
- "subtotal": cộng tiền hàng trước thuế. "vat_amount": tổng tiền thuế GTGT. "total_amount": tổng tiền thanh toán SAU thuế
  (sau chiết khấu nếu có). Không có thì null.

THANH TOÁN / CÔNG NỢ:
- "payment_status": "paid" nếu có dấu hiệu RÕ đã trả đủ (chữ/con dấu "Đã thanh toán", "Đã thu tiền", "Paid", ghi đã nhận đủ tiền);
  "partial" nếu ghi đã trả trước / đặt cọc một phần; "unpaid" nếu ghi "Chưa thanh toán", "Công nợ", "Ghi nợ", có hạn thanh toán,
  hoặc là phiếu giao hàng ghi rõ thanh toán sau; còn lại "unknown".
  Chỉ ghi "Hình thức thanh toán: TM/CK" thì CHƯA đủ để kết luận đã trả → "unknown".
- "paid_amount": số tiền đã trả nếu ghi rõ, không có thì 0.
- "payment_method": "cash" (TM, tiền mặt), "transfer" (CK, chuyển khoản), "other"; chỉ điền khi ghi rõ một hình thức, không thì "unknown".
- "due_date": hạn thanh toán (YYYY-MM-DD) nếu có ghi, không có thì chuỗi rỗng "".
- "catalog_no": nếu mặt hàng chắc chắn là một nguyên liệu trong DANH MỤC bên dưới (cùng loại hàng, có thể khác cách viết)
  thì ghi số thứ tự của nó; nếu không chắc hoặc không có thì null.
- "warning": ghi ngắn bằng tiếng Việt nếu có chỗ không đọc rõ / nghi ngờ (vd "Dòng 3 mờ, số lượng không chắc"), không có thì chuỗi rỗng "".
- "invoice_number": số hóa đơn / số phiếu, không có thì chuỗi rỗng "".`;

function catalogText(catalog: CatalogEntry[], suppliers: string[]): string {
  const items = catalog.length
    ? catalog
        .map((c) => `${c.no}. ${c.name} (đơn vị kho: ${c.baseUnit}${c.units.length ? `; đơn vị khác: ${c.units.join(", ")}` : ""})`)
        .join("\n")
    : "(chưa có)";
  const sups = suppliers.length ? suppliers.join("; ") : "(chưa có)";
  return `DANH MỤC NGUYÊN LIỆU:\n${items}\n\nNHÀ CUNG CẤP ĐÃ BIẾT: ${sups}`;
}

export function invoiceAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Gửi ảnh hóa đơn cho Claude, nhận về dữ liệu có cấu trúc. */
export async function extractInvoice(
  image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" },
  catalog: CatalogEntry[],
  suppliers: string[]
): Promise<InvoiceAiResult> {
  const model = process.env.INVOICE_AI_MODEL || DEFAULT_MODEL;
  if (!invoiceAiConfigured()) {
    return { ok: false, model, message: "Chưa cài khóa AI (ANTHROPIC_API_KEY). Vui lòng nhập tay hoặc báo Quản trị viên." };
  }

  const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      output_config: { effort: "medium", format: zodOutputFormat(InvoiceSchema) },
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        // Danh mục ít thay đổi → cache để các lần quét sau rẻ hơn (nếu đủ dài)
        { type: "text", text: catalogText(catalog, suppliers), cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
            { type: "text", text: "Đọc hóa đơn trong ảnh này." },
          ],
        },
      ],
    });

    const usage = {
      inputTokens:
        response.usage.input_tokens +
        (response.usage.cache_creation_input_tokens ?? 0) +
        (response.usage.cache_read_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
    };

    if (response.stop_reason === "refusal") {
      return { ok: false, model, ...usage, message: "AI không xử lý được ảnh này. Vui lòng nhập tay." };
    }
    if (response.stop_reason === "max_tokens" || !response.parsed_output) {
      return { ok: false, model, ...usage, message: "AI đọc không trọn hóa đơn. Hãy chụp lại rõ hơn hoặc nhập tay." };
    }
    return { ok: true, model, data: response.parsed_output, ...usage };
  } catch (error) {
    console.error("[invoice-ai]", error);
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, model, message: "Khóa AI không hợp lệ hoặc hết hạn. Báo Quản trị viên kiểm tra ANTHROPIC_API_KEY." };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, model, message: "AI đang quá tải. Vui lòng thử lại sau ít phút." };
    }
    // Lỗi gốc (tiếng Anh) được lưu vào invoice_scans.error để tra cứu
    const detail = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
    if (error instanceof Anthropic.BadRequestError) {
      if (/credit balance|billing|insufficient/i.test(detail)) {
        return { ok: false, model, detail, message: "Tài khoản API AI đã hết số dư. Vui lòng nhập tay và báo Quản trị viên nạp thêm." };
      }
      return { ok: false, model, detail, message: "AI không xử lý được yêu cầu này (lỗi hệ thống). Vui lòng nhập tay và báo Quản trị viên." };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { ok: false, model, detail, message: "Không kết nối được tới AI. Kiểm tra mạng rồi thử lại." };
    }
    return { ok: false, model, detail, message: "AI gặp lỗi khi đọc hóa đơn. Vui lòng thử lại hoặc nhập tay." };
  }
}
