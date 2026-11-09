import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { logoKind, openPdf, pdfMoney, pricedColumns, qtyColumns } from "../lib/pdfKit";

/**
 * PH2-28 — one letterhead draws the company, a table, the totals, and
 * the footer. A logo that will not embed is left off, and the page
 * still saves.
 */

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

async function pdfText(bytes: Uint8Array): Promise<string> {
  const raw = Buffer.from(bytes).toString("latin1");
  expect(raw.startsWith("%PDF-")).toBe(true);
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => {
    const body = match[1] ?? "";
    try {
      return inflateSync(Buffer.from(body, "latin1")).toString("latin1");
    } catch {
      return body;
    }
  });
  return streams
    .join("\n")
    .replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) => Buffer.from(hex, "hex").toString("latin1"));
}

describe("pdf kit", () => {
  test("money stays the document string", () => {
    expect(pdfMoney(192, 2, "GBP")).toBe("192.00 GBP");
  });

  test("a png and a jpeg are logos, and anything else is not", () => {
    expect(logoKind(PNG)?.kind).toBe("png");
    expect(logoKind(Uint8Array.from([0xff, 0xd8, 0xff]))?.kind).toBe("jpg");
    expect(logoKind(Uint8Array.from([0x00, 0x01]))).toBeNull();
  });

  test("the letterhead, the table, the totals, and the footer share one page kit", async () => {
    const rows = Array.from({ length: 80 }, (_, index) => [
      `Widget ${index} · SKU-${index}`,
      "1",
      "2.00 GBP",
      "2.00 GBP",
      "0.00 GBP",
      "2.00 GBP",
    ]);
    rows[79] = ["Last row · SKU-LAST", "3", "9.00 GBP", "9.00 GBP", "0.00 GBP", "9.00 GBP"];
    const doc = await openPdf({
      companyName: "Chris",
      logo: { bytes: PNG, kind: "png" },
      footer: "Payment due within 30 days.",
    });
    doc.title("Quote QT-0099");
    doc.table(pricedColumns(), rows);
    doc.totals([{ label: "Total", value: "9.00 GBP", emphasize: true }]);
    doc.notes("Morning delivery");
    const bytes = await doc.save();
    const text = await pdfText(bytes);
    expect(text).toContain("Chris");
    expect(text).toContain("QT-0099");
    expect(text).toContain("SKU-LAST");
    expect(text).toContain("9.00 GBP");
    expect(text).toContain("Total");
    expect(text).toContain("Morning delivery");
    expect(text).toContain("Payment due within 30 days.");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    expect(Buffer.from(bytes).toString("latin1")).toContain("/Image");
  });

  test("a logo that will not embed is skipped", async () => {
    const doc = await openPdf({
      companyName: "Chris",
      logo: { bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00]), kind: "png" },
      footer: null,
    });
    doc.title("Still prints");
    doc.table(qtyColumns(), [["Bench · DEMO-1006", "1"]]);
    const bytes = await doc.save();
    const text = await pdfText(bytes);
    expect(text).toContain("Still prints");
    expect(text).toContain("DEMO-1006");
    expect(text).toContain("Qty");
    expect(Buffer.from(bytes).toString("latin1")).not.toContain("/Image");
  });
});
