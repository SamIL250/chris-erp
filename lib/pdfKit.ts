import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { formatUnitPrice } from "./pricing";

/**
 * Shared letterhead for quotes, purchase orders, invoices, packing slips,
 * and the pick list (PH2-28). Built in the browser. A logo that will not
 * embed is skipped, and the PDF still downloads.
 */

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.35, 0.38, 0.42);
const RULE = rgb(0.82, 0.84, 0.86);

export type PdfLogoKind = "png" | "jpg";

export type PdfLogo = {
  bytes: Uint8Array;
  kind: PdfLogoKind;
};

export type PdfAlign = "left" | "right";

export type PdfWeight = "regular" | "bold";

export type PdfColumn = {
  header: string;
  width: number;
  align: PdfAlign;
};

export type PdfTotal = {
  label: string;
  value: string;
  emphasize?: boolean;
};

export type PdfWriter = {
  title(text: string): void;
  line(text: string, size?: number, weight?: PdfWeight): void;
  gap(): void;
  table(columns: PdfColumn[], rows: string[][]): void;
  totals(rows: PdfTotal[]): void;
  notes(text: string | null): void;
  save(): Promise<Uint8Array>;
};

/** "192.00 GBP" — the same money string the document tests look for. */
export function pdfMoney(amount: number, decimalPlaces: number, currency: string): string {
  return `${formatUnitPrice(amount, decimalPlaces)} ${currency}`;
}

/** WinAnsi cannot draw past Latin-1, so anything else becomes a question mark. */
export function pdfText(value: string): string {
  return value.replace(/[^\u0020-\u00FF]/g, "?");
}

/** PNG and JPEG only. Anything else is left off the page. */
export function logoKind(bytes: Uint8Array): PdfLogo | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { bytes, kind: "png" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { bytes, kind: "jpg" };
  }
  return null;
}

/** Best-effort logo fetch. A network or CORS failure returns null. */
export async function loadPdfLogo(url: string | null): Promise<PdfLogo | null> {
  if (url === null || url === "") return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return logoKind(new Uint8Array(await response.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Company name, invoice footer, and logo for a download button. */
export async function pdfCompany(
  org: { name?: string; invoiceFooter?: string | null; logoUrl?: string | null } | null | undefined,
  fallbackName: string,
): Promise<{ companyName: string; footer: string | null; logo: PdfLogo | null }> {
  const name = org?.name?.trim() ?? "";
  const footer = org?.invoiceFooter?.trim() ?? "";
  return {
    companyName: name === "" ? fallbackName : name,
    footer: footer === "" ? null : footer,
    logo: await loadPdfLogo(org?.logoUrl ?? null),
  };
}

/** Item, quantity, unit, net, tax, and gross across the A4 content width. */
export function pricedColumns(): PdfColumn[] {
  return [
    { header: "Item", width: CONTENT_WIDTH - 312, align: "left" },
    { header: "Qty", width: 36, align: "right" },
    { header: "Unit", width: 72, align: "right" },
    { header: "Net", width: 68, align: "right" },
    { header: "Tax", width: 64, align: "right" },
    { header: "Gross", width: 72, align: "right" },
  ];
}

/** Item and quantity, for a packing slip or a pick list. */
export function qtyColumns(): PdfColumn[] {
  return [
    { header: "Item", width: CONTENT_WIDTH - 79, align: "left" },
    { header: "Qty", width: 79, align: "right" },
  ];
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const clean = pdfText(text).trim();
  if (clean === "") return [];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current === "" ? word : `${current} ${word}`;
    if (current === "" || font.widthOfTextAtSize(next, size) <= width) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}

async function embedLogo(doc: PDFDocument, logo: PdfLogo | null): Promise<PDFImage | null> {
  if (logo === null) return null;
  try {
    switch (logo.kind) {
      case "png":
        return await doc.embedPng(logo.bytes);
      case "jpg":
        return await doc.embedJpg(logo.bytes);
      default: {
        const unreachable: never = logo.kind;
        return unreachable;
      }
    }
  } catch {
    return null;
  }
}

function textX(align: PdfAlign, colX: number, colWidth: number, textWidth: number): number {
  switch (align) {
    case "left":
      return colX + 4;
    case "right":
      return colX + colWidth - textWidth - 4;
    default: {
      const unreachable: never = align;
      return unreachable;
    }
  }
}

/** A fresh A4 document with the company header already drawn. */
export async function openPdf(input: {
  companyName: string;
  logo?: PdfLogo | null;
  footer?: string | null;
}): Promise<PdfWriter> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const image = await embedLogo(doc, input.logo ?? null);
  const footerLines = wrap(font, input.footer ?? "", 8, CONTENT_WIDTH - 36).slice(0, 4);
  const floor = 28 + footerLines.length * 11;

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const face = (weight: PdfWeight): PDFFont => {
    switch (weight) {
      case "regular":
        return font;
      case "bold":
        return bold;
      default: {
        const unreachable: never = weight;
        return unreachable;
      }
    }
  };

  const breakPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    page.drawText(pdfText(input.companyName), {
      x: MARGIN,
      y,
      size: 10,
      font: bold,
      color: INK,
    });
    y -= 16;
  };

  const ensure = (height: number) => {
    if (y - height < floor) breakPage();
  };

  const write = (text: string, size: number, weight: PdfWeight) => {
    const used = face(weight);
    const lines = wrap(used, text, size, CONTENT_WIDTH);
    for (const line of lines) {
      ensure(size + 6);
      page.drawText(pdfText(line), { x: MARGIN, y, size, font: used, color: INK });
      y -= size + 6;
    }
  };

  if (image === null) {
    write(input.companyName, 12, "bold");
  } else {
    const scale = Math.min(32 / image.height, 72 / image.width);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, { x: MARGIN, y: y - height, width, height });
    page.drawText(pdfText(input.companyName), {
      x: MARGIN + width + 10,
      y: y - height / 2 - 4,
      size: 12,
      font: bold,
      color: INK,
    });
    y -= height + 12;
  }

  const rule = (at: number) => {
    page.drawLine({
      start: { x: MARGIN, y: at },
      end: { x: MARGIN + CONTENT_WIDTH, y: at },
      thickness: 0.4,
      color: RULE,
    });
  };

  const columnRules = (top: number, bottom: number, columns: PdfColumn[]) => {
    let x = MARGIN;
    const draw = (at: number) => {
      page.drawLine({
        start: { x: at, y: bottom },
        end: { x: at, y: top },
        thickness: 0.4,
        color: RULE,
      });
    };
    draw(x);
    for (const col of columns) {
      x += col.width;
      draw(x);
    }
  };

  return {
    title(text) {
      write(text, 18, "bold");
    },
    line(text, size = 11, weight = "regular") {
      write(text, size, weight);
    },
    gap() {
      y -= 8;
    },
    table(columns, rows) {
      const stated = columns.reduce((sum, col) => sum + col.width, 0);
      const scale = stated === 0 ? 1 : CONTENT_WIDTH / stated;
      const cols = columns.map((col) => ({ ...col, width: col.width * scale }));
      const size = 9;

      const drawHeader = () => {
        ensure(size + 8);
        const top = y + size;
        let x = MARGIN;
        for (const col of cols) {
          const header = pdfText(col.header);
          const width = bold.widthOfTextAtSize(header, size);
          page.drawText(header, {
            x: textX(col.align, x, col.width, width),
            y,
            size,
            font: bold,
            color: INK,
          });
          x += col.width;
        }
        const bottom = y - 4;
        columnRules(top, bottom, cols);
        rule(bottom);
        y = bottom - 12;
      };

      drawHeader();
      for (const row of rows) {
        const wrapped = cols.map((col, index) =>
          wrap(font, row[index] ?? "", size, Math.max(8, col.width - 8)),
        );
        const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
        const rowHeight = lineCount * (size + 4) + 8;
        if (y - rowHeight < floor) {
          breakPage();
          drawHeader();
        }
        const top = y + size;
        let x = MARGIN;
        cols.forEach((col, index) => {
          const lines = wrapped[index] ?? [];
          lines.forEach((cell, lineIndex) => {
            const text = pdfText(cell);
            const width = font.widthOfTextAtSize(text, size);
            page.drawText(text, {
              x: textX(col.align, x, col.width, width),
              y: y - lineIndex * (size + 4),
              size,
              font,
              color: INK,
            });
          });
          x += col.width;
        });
        const bottom = y - (lineCount - 1) * (size + 4) - 4;
        columnRules(top, bottom, cols);
        rule(bottom);
        y = bottom - 12;
      }
    },
    totals(rows) {
      if (rows.length === 0) return;
      y -= 8;
      for (const row of rows) {
        const emphasize = row.emphasize === true;
        const size = emphasize ? 12 : 11;
        const weight: PdfWeight = emphasize ? "bold" : "regular";
        const used = face(weight);
        ensure(size + 6);
        const value = pdfText(row.value);
        page.drawText(pdfText(row.label), {
          x: MARGIN + CONTENT_WIDTH - 150,
          y,
          size,
          font: used,
          color: INK,
        });
        page.drawText(value, {
          x: MARGIN + CONTENT_WIDTH - used.widthOfTextAtSize(value, size),
          y,
          size,
          font: used,
          color: INK,
        });
        y -= size + 6;
      }
    },
    notes(text) {
      if (text === null || text.trim() === "") return;
      y -= 8;
      write("Notes", 11, "bold");
      write(text, 10, "regular");
    },
    save() {
      for (const [index, painted] of doc.getPages().entries()) {
        paintFooter(painted, font, footerLines, index + 1);
      }
      return doc.save();
    },
  };
}

function paintFooter(page: PDFPage, font: PDFFont, lines: string[], pageNumber: number) {
  lines.forEach((line, index) => {
    page.drawText(pdfText(line), {
      x: MARGIN,
      y: 16 + (lines.length - 1 - index) * 11,
      size: 8,
      font,
      color: MUTED,
    });
  });
  const number = String(pageNumber);
  page.drawText(number, {
    x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(number, 8),
    y: 16,
    size: 8,
    font,
    color: MUTED,
  });
}
