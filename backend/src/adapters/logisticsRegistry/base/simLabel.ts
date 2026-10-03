import fs from "fs";
import path from "path";
import { uploadsDir } from "../../../routes/upload.js";

function pdfEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** Minimal single-page PDF (Helvetica) — no external PDF dependency. */
export function buildShippingLabelPdf(parts: {
  carrier: string;
  awb: string;
  orderId: string;
  marketplace?: string;
  customerName?: string;
}): Buffer {
  const lines = [
    "SHIPPING LABEL",
    `Carrier: ${parts.carrier}`,
    `AWB: ${parts.awb}`,
    `Order: ${parts.orderId}`,
    parts.marketplace ? `Channel: ${parts.marketplace}` : "",
    parts.customerName ? `Ship to: ${parts.customerName}` : "",
    `Generated: ${new Date().toISOString()}`,
    "fybud ERM — Simulation Label",
  ].filter(Boolean);

  const contentLines = ["BT", "/F1 18 Tf", "50 780 Td", `(${pdfEscape(lines[0])}) Tj`];
  for (let i = 1; i < lines.length; i++) {
    contentLines.push("0 -28 Td", "/F1 12 Tf", `(${pdfEscape(lines[i])}) Tj`);
  }
  contentLines.push("ET");
  const stream = contentLines.join("\n");

  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n");
  objects.push(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
  );
  objects.push(`4 0 obj << /Length ${Buffer.byteLength(stream, "utf8")} >> stream\n${stream}\nendstream endobj\n`);
  objects.push("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64);
}

export function writeSimLabelPdf(parts: {
  carrier: string;
  awb: string;
  orderId: string;
  marketplace?: string;
  customerName?: string;
}): { relativeUrl: string; absolutePath: string; base64: string } {
  const labelsDir = path.join(uploadsDir, "labels");
  fs.mkdirSync(labelsDir, { recursive: true });
  const filename = `${safeFilePart(parts.carrier)}-${safeFilePart(parts.awb)}.pdf`;
  const absolutePath = path.join(labelsDir, filename);
  const pdf = buildShippingLabelPdf(parts);
  fs.writeFileSync(absolutePath, pdf);
  return {
    relativeUrl: `/uploads/labels/${filename}`,
    absolutePath,
    base64: pdf.toString("base64"),
  };
}
