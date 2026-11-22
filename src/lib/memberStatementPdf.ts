/**
 * Bank-style member statement PDF (no external deps).
 * Clean header, summary strip, tabular movements, footer.
 */

function esc(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function money(n: number): string {
  const v = Math.round(Number(n) || 0);
  return `KES ${v.toLocaleString("en-KE")}`;
}

function padRight(s: string, n: number): string {
  const t = String(s ?? "");
  return t.length >= n ? t.slice(0, n) : t + " ".repeat(n - t.length);
}

function padLeft(s: string, n: number): string {
  const t = String(s ?? "");
  return t.length >= n ? t.slice(0, n) : " ".repeat(n - t.length) + t;
}

export type StatementLine = {
  date: string;
  pot: string;
  amount: number;
  status?: string;
  reference?: string;
};

type DrawCmd = string;

function textAt(x: number, y: number, size: number, str: string): DrawCmd {
  return `BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${esc(str)}) Tj ET`;
}

function boldAt(x: number, y: number, size: number, str: string): DrawCmd {
  return `BT /F2 ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${esc(str)}) Tj ET`;
}

function line(x1: number, y1: number, x2: number, y2: number, w = 0.6): DrawCmd {
  return `${w} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`;
}

function rectStroke(x: number, y: number, w: number, h: number, lw = 0.8): DrawCmd {
  return `${lw} w ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S`;
}

function rectFillGray(x: number, y: number, w: number, h: number, gray: number): DrawCmd {
  return `${gray} g ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f 0 g`;
}

function buildPageContent(opts: {
  chamaName: string;
  memberName: string;
  lines: StatementLine[];
  potBalances?: { label: string; balance: number }[];
  generatedAt: Date;
  pageNum: number;
  pageCount: number;
  sliceStart: number;
  sliceEnd: number;
  totalPaid: number;
  isFirst: boolean;
  isLast: boolean;
}): string {
  const W = 595;
  const H = 842;
  const L = 40;
  const R = W - 40;
  const cmds: DrawCmd[] = [];

  let y = H - 36;

  // Top brand bar
  cmds.push(rectFillGray(0, H - 28, W, 28, 0.12));
  cmds.push("1 g");
  cmds.push(boldAt(L, H - 18, 11, "ChamaVault"));
  cmds.push(textAt(R - 130, H - 18, 9, "MEMBER STATEMENT"));
  cmds.push("0 g");

  y = H - 48;
  cmds.push(boldAt(L, y, 16, "Account statement"));
  y -= 16;
  cmds.push(textAt(L, y, 9, "Zero-cash treasury  ·  Confidential — for member records"));
  y -= 10;
  cmds.push(line(L, y, R, y, 1.2));

  y -= 20;
  // Account biodata box — generous padding so labels never collide with values
  const boxH = 78;
  const boxBottom = y - boxH;
  cmds.push(rectStroke(L, boxBottom, R - L, boxH, 0.7));
  const padX = 14;
  const leftX = L + padX;
  const midX = L + (R - L) / 2 + padX;
  // Row 1: CHAMA / STATEMENT DATE
  cmds.push(boldAt(leftX, y - 16, 8, "CHAMA"));
  cmds.push(boldAt(midX, y - 16, 8, "STATEMENT DATE"));
  cmds.push(textAt(leftX, y - 32, 10, opts.chamaName.slice(0, 36)));
  cmds.push(
    textAt(
      midX,
      y - 32,
      10,
      opts.generatedAt.toLocaleDateString("en-KE", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    ),
  );
  // Row 2: MEMBER / CURRENCY (extra vertical gap from row 1)
  cmds.push(boldAt(leftX, y - 50, 8, "MEMBER"));
  cmds.push(boldAt(midX, y - 50, 8, "CURRENCY"));
  cmds.push(textAt(leftX, y - 66, 10, opts.memberName.slice(0, 36)));
  cmds.push(textAt(midX, y - 66, 10, "Kenya Shilling (KES)"));

  y = boxBottom - 16;

  if (opts.isFirst) {
    // Summary strip
    cmds.push(rectFillGray(L, y - 36, R - L, 42, 0.94));
    cmds.push(rectStroke(L, y - 36, R - L, 42, 0.5));
    const colW = (R - L) / 3;
    cmds.push(boldAt(L + 10, y - 12, 8, "TOTAL CREDITED"));
    cmds.push(boldAt(L + 10, y - 28, 12, money(opts.totalPaid)));
    cmds.push(boldAt(L + colW + 10, y - 12, 8, "TRANSACTIONS"));
    cmds.push(boldAt(L + colW + 10, y - 28, 12, String(opts.lines.length)));
    cmds.push(boldAt(L + colW * 2 + 10, y - 12, 8, "POTS WITH BALANCE"));
    cmds.push(
      boldAt(
        L + colW * 2 + 10,
        y - 28,
        12,
        String(opts.potBalances?.filter((p) => p.balance > 0).length ?? 0),
      ),
    );
    y -= 52;

    // Pot balances section
    if (opts.potBalances && opts.potBalances.length > 0) {
      cmds.push(boldAt(L, y, 10, "Balances by pot"));
      y -= 6;
      cmds.push(line(L, y, R, y, 0.5));
      y -= 14;
      for (const p of opts.potBalances) {
        if (y < 80) break;
        cmds.push(textAt(L + 4, y, 9, p.label.slice(0, 36)));
        cmds.push(boldAt(R - 90, y, 9, money(p.balance)));
        y -= 13;
      }
      y -= 8;
    }

    cmds.push(boldAt(L, y, 10, "Payment history"));
    y -= 6;
    cmds.push(line(L, y, R, y, 0.8));
    y -= 4;
  }

  // Table header
  cmds.push(rectFillGray(L, y - 16, R - L, 18, 0.9));
  cmds.push(boldAt(L + 6, y - 12, 8, "DATE"));
  cmds.push(boldAt(L + 78, y - 12, 8, "DESCRIPTION / POT"));
  cmds.push(boldAt(R - 100, y - 12, 8, "AMOUNT"));
  y -= 22;

  const slice = opts.lines.slice(opts.sliceStart, opts.sliceEnd);
  let row = 0;
  for (const item of slice) {
    if (y < 70) break;
    if (row % 2 === 1) {
      cmds.push(rectFillGray(L, y - 4, R - L, 14, 0.96));
    }
    const d = String(item.date).slice(0, 10);
    const pot = (item.pot || "Contribution").slice(0, 40);
    cmds.push(textAt(L + 6, y, 9, d));
    cmds.push(textAt(L + 78, y, 9, pot));
    cmds.push(boldAt(R - 100, y, 9, money(item.amount)));
    y -= 14;
    row++;
  }

  if (opts.isLast) {
    y -= 6;
    cmds.push(line(L, y, R, y, 1));
    y -= 16;
    cmds.push(boldAt(L + 6, y, 10, "Closing total (all listed payments)"));
    cmds.push(boldAt(R - 100, y, 11, money(opts.totalPaid)));
    y -= 20;
    cmds.push(rectStroke(L, y - 36, R - L, 40, 0.5));
    cmds.push(
      textAt(
        L + 8,
        y - 14,
        8,
        "This statement summarises contributions recorded in ChamaVault for your membership.",
      ),
    );
    cmds.push(
      textAt(
        L + 8,
        y - 26,
        8,
        "It is not a bank advice. For disputes, contact your chama treasurer with the date and amount.",
      ),
    );
  }

  // Footer
  cmds.push(line(L, 48, R, 48, 0.4));
  cmds.push(
    textAt(
      L,
      36,
      8,
      `Page ${opts.pageNum} of ${opts.pageCount}  ·  ChamaVault  ·  ${opts.chamaName.slice(0, 28)}`,
    ),
  );
  cmds.push(textAt(R - 120, 36, 8, "www — keep for your records"));

  return cmds.join("\n");
}

function assemblePdf(pageStreams: string[]): Blob {
  const W = 595;
  const H = 842;
  const parts: string[] = [];
  const offsets: number[] = [0];

  const encoder = new TextEncoder();
  let length = 0;
  const push = (s: string) => {
    parts.push(s);
    length += encoder.encode(s).length;
  };

  push("%PDF-1.4\n");

  const objPositions: number[] = [];
  const startObj = () => {
    objPositions.push(length);
  };

  // 1 Catalog
  startObj();
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // 2 Pages (kids filled after we know page count)
  const pageCount = pageStreams.length;
  const pageObjNums = pageStreams.map((_, i) => 3 + i * 2); // 3,5,7,...
  const contentObjNums = pageStreams.map((_, i) => 4 + i * 2); // 4,6,8,...

  startObj();
  push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageCount} >>\nendobj\n`,
  );

  // Font objects at end: F1 Helvetica, F2 Helvetica-Bold
  const fontRegular = 3 + pageCount * 2;
  const fontBold = fontRegular + 1;

  for (let i = 0; i < pageCount; i++) {
    const pageNo = pageObjNums[i];
    const contentNo = contentObjNums[i];
    const stream = pageStreams[i];

    startObj();
    push(
      `${pageNo} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${contentNo} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >>\nendobj\n`,
    );

    startObj();
    push(
      `${contentNo} 0 obj\n<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  }

  startObj();
  push(
    `${fontRegular} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
  );
  startObj();
  push(
    `${fontBold} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`,
  );

  const xrefPos = length;
  const totalObjs = 2 + pageCount * 2 + 2; // catalog, pages, pages*2, 2 fonts
  let xref = `xref\n0 ${totalObjs + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 0; i < totalObjs; i++) {
    xref += `${String(objPositions[i]).padStart(10, "0")} 00000 n \n`;
  }
  push(xref);
  push(
    `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`,
  );

  return new Blob(parts, { type: "application/pdf" });
}

export function downloadMemberStatementPdf(opts: {
  chamaName: string;
  memberName: string;
  lines: StatementLine[];
  potBalances?: { label: string; balance: number }[];
  generatedAt?: Date;
}): void {
  const generatedAt = opts.generatedAt ?? new Date();
  const lines = [...opts.lines].sort((a, b) =>
    String(b.date).localeCompare(String(a.date)),
  );
  const totalPaid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  // Rows per page (first page has less room due to header/summary)
  const firstPageRows = 18;
  const nextPageRows = 36;
  const slices: { start: number; end: number }[] = [];
  if (lines.length === 0) {
    slices.push({ start: 0, end: 0 });
  } else {
    let i = 0;
    slices.push({ start: 0, end: Math.min(firstPageRows, lines.length) });
    i = firstPageRows;
    while (i < lines.length) {
      slices.push({ start: i, end: Math.min(i + nextPageRows, lines.length) });
      i += nextPageRows;
    }
  }

  const pageCount = slices.length;
  const streams = slices.map((sl, idx) =>
    buildPageContent({
      chamaName: opts.chamaName,
      memberName: opts.memberName,
      lines,
      potBalances: opts.potBalances,
      generatedAt,
      pageNum: idx + 1,
      pageCount,
      sliceStart: sl.start,
      sliceEnd: sl.end,
      totalPaid,
      isFirst: idx === 0,
      isLast: idx === pageCount - 1,
    }),
  );

  const blob = assemblePdf(streams);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = opts.memberName.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 24);
  a.href = url;
  a.download = `ChamaVault-Statement-${safe}-${generatedAt.toISOString().slice(0, 10)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
