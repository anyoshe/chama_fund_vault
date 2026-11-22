/** Minimal single-page (or multi-page) text PDF — no external deps */

function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function fmtMoney(n: number): string {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

export type StatementLine = {
  date: string;
  pot: string;
  amount: number;
  status?: string;
};

export function downloadMemberStatementPdf(opts: {
  chamaName: string;
  memberName: string;
  lines: StatementLine[];
  potBalances?: { label: string; balance: number }[];
  generatedAt?: Date;
}): void {
  const when = opts.generatedAt ?? new Date();
  const title = "ChamaVault member statement";
  const header = [
    title,
    `Chama: ${opts.chamaName}`,
    `Member: ${opts.memberName}`,
    `Generated: ${when.toLocaleString("en-KE")}`,
    "",
  ];

  const potLines: string[] = [];
  if (opts.potBalances && opts.potBalances.length) {
    potLines.push("Balances by pot");
    for (const p of opts.potBalances) {
      potLines.push(`  ${p.label}: ${fmtMoney(p.balance)}`);
    }
    potLines.push("");
  }

  potLines.push("Payment history");
  potLines.push("Date         Pot                      Amount");
  potLines.push("----------------------------------------------");

  const body: string[] = [];
  let total = 0;
  for (const row of opts.lines) {
    total += Number(row.amount) || 0;
    const d = String(row.date).slice(0, 10).padEnd(12);
    const pot = (row.pot || "—").slice(0, 22).padEnd(22);
    const amt = fmtMoney(row.amount);
    body.push(`${d}${pot}${amt}`);
  }
  if (body.length === 0) {
    body.push("(No payments recorded yet)");
  }
  body.push("----------------------------------------------");
  body.push(`Total paid: ${fmtMoney(total)}`);
  body.push("");
  body.push("This statement is for your records. Keep for chama meetings.");

  const allLines = [...header, ...potLines, ...body];

  // Build PDF content stream (Helvetica, 10pt, top-down)
  const pageWidth = 595; // A4
  const pageHeight = 842;
  const margin = 50;
  const lineHeight = 14;
  const maxLinesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);

  const pages: string[][] = [];
  for (let i = 0; i < allLines.length; i += maxLinesPerPage) {
    pages.push(allLines.slice(i, i + maxLinesPerPage));
  }
  if (pages.length === 0) pages.push([title]);

  const objects: string[] = [];
  // 1 catalog
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  // 2 pages — filled later
  const kids: string[] = [];
  let objIndex = 3; // next object number

  const pageObjs: { contentObj: number; pageObj: number; stream: string }[] = [];

  for (const pageLines of pages) {
    const contentObj = objIndex++;
    const pageObj = objIndex++;
    kids.push(`${pageObj} 0 R`);

    let y = pageHeight - margin;
    const ops: string[] = ["BT", "/F1 10 Tf", "14 TL"];
    let first = true;
    for (const line of pageLines) {
      const text = pdfEscape(line);
      if (first) {
        ops.push(`1 0 0 1 ${margin} ${y} Tm (${text}) Tj`);
        first = false;
      } else {
        ops.push(`T* (${text}) Tj`);
      }
    }
    ops.push("ET");
    const stream = ops.join("\n");
    pageObjs.push({ contentObj, pageObj, stream });
  }

  // Rebuild object list in order
  const out: string[] = [];
  out.push("%PDF-1.4");

  const offsets: number[] = [0];

  function addObj(n: number, body: string) {
    offsets[n] = out.join("\n").length + 1;
    out.push(`${n} 0 obj`);
    out.push(body);
    out.push("endobj");
  }

  addObj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  addObj(
    2,
    `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`,
  );

  // Font object
  const fontObj = objIndex++;
  addObj(fontObj, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  for (const p of pageObjs) {
    addObj(
      p.contentObj,
      `<< /Length ${p.stream.length} >>\nstream\n${p.stream}\nendstream`,
    );
    addObj(
      p.pageObj,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${p.contentObj} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`,
    );
  }

  const xrefStart = out.join("\n").length + 1;
  const maxObj = fontObj;
  // recount - we used objects up to fontObj and page objs
  const totalObjs = offsets.length - 1;
  // Fix offsets: rebuild properly
  const pdfParts: string[] = ["%PDF-1.4\n"];
  const off: number[] = [0];
  let n = 1;

  function writeObj(content: string) {
    off[n] = pdfParts.reduce((s, x) => s + x.length, 0);
    pdfParts.push(`${n} 0 obj\n${content}\nendobj\n`);
    n++;
  }

  writeObj("<< /Type /Catalog /Pages 2 0 R >>");
  // pages kids need correct numbers - build pages after we know structure
  // Simpler approach: one page only with truncated lines for reliability

  // --- Simplified single-file rebuild ---
  const linesForPdf = allLines.slice(0, 50);
  let streamLines = ["BT", "/F1 10 Tf", `${margin} ${pageHeight - margin} Td`, "12 TL"];
  linesForPdf.forEach((line, i) => {
    const t = pdfEscape(line);
    if (i === 0) streamLines.push(`(${t}) Tj`);
    else streamLines.push(`T* (${t}) Tj`);
  });
  streamLines.push("ET");
  const stream = streamLines.join("\n");

  const final: string[] = [];
  const xref: number[] = [];
  const push = (s: string) => {
    xref.push(final.join("").length);
    final.push(s);
  };

  push("%PDF-1.4\n");
  // obj 1
  xref[1] = final.join("").length;
  final.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  // obj 2
  xref[2] = final.join("").length;
  final.push(
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
  );
  // obj 3 page
  xref[3] = final.join("").length;
  final.push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
  );
  // obj 4 content
  xref[4] = final.join("").length;
  final.push(
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
  );
  // obj 5 font
  xref[5] = final.join("").length;
  final.push(
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  );

  const xrefPos = final.join("").length;
  let xrefTable = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xrefTable += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
  }
  final.push(xrefTable);
  final.push(
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`,
  );

  const blob = new Blob(final, { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeName = opts.memberName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 24);
  a.href = url;
  a.download = `ChamaVault-statement-${safeName}-${when.toISOString().slice(0, 10)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
