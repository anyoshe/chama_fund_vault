import type { Contribution, Member } from "@/types/chama";

const POT_LABEL: Record<string, string> = {
  "table-banking": "Table banking",
  "share-capital": "Share capital",
  "general-savings": "General savings",
  "member-loans": "Member loans",
  "merry-go-round": "Merry-go-round",
  welfare: "Welfare",
  contingency: "Contingency",
  "registration-fees": "Registration",
  "group-reserve": "Group reserve",
};

export function potLabel(code: string) {
  return POT_LABEL[code] || code.replace(/-/g, " ");
}

export function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${names[(m || 1) - 1]} ${y}`;
}

/** List YYYY-MM from start (inclusive) to end (inclusive) */
export function monthsInRange(fromYm: string, toYm: string): string[] {
  const out: string[] = [];
  let [y, m] = fromYm.split("-").map(Number);
  const [ey, em] = toYm.split("-").map(Number);
  if (!y || !m || !ey || !em) return out;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 36) break; // safety
  }
  return out;
}

export function contributionMonthKey(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 7);
  return monthKey(d);
}

/**
 * Build matrix: member × month → amount paid into pot(s).
 * If potCode is null/all, sums all destinations.
 */
export function buildMonthlyPotMatrix(opts: {
  members: Member[];
  contributions: Contribution[];
  potCode: string | "all";
  fromYm: string;
  toYm: string;
}) {
  const months = monthsInRange(opts.fromYm, opts.toYm);
  const memberIds = opts.members
    .filter((m) => m.role !== "New Applicant")
    .map((m) => m.id);

  const totals: Record<string, Record<string, number>> = {};
  for (const id of memberIds) {
    totals[id] = {};
    for (const mk of months) totals[id][mk] = 0;
  }

  for (const c of opts.contributions) {
    if (c.status && c.status !== "completed" && c.status !== "confirmed") continue;
    if (opts.potCode !== "all" && c.destination !== opts.potCode) continue;
    const mk = contributionMonthKey(c.date || "");
    if (!totals[c.memberId] || totals[c.memberId][mk] === undefined) continue;
    totals[c.memberId][mk] += Number(c.amount) || 0;
  }

  return { months, totals };
}

/** CSV that Excel opens (UTF-8 BOM). Paid = amount; empty month = NOT PAID */
export function monthlyPotMatrixToCsv(opts: {
  chamaName: string;
  potCode: string | "all";
  members: Member[];
  months: string[];
  totals: Record<string, Record<string, number>>;
}): string {
  const potTitle =
    opts.potCode === "all" ? "All pots" : potLabel(opts.potCode);
  const header = [
    "Member",
    "Role",
    ...opts.months.map(monthLabel),
    "Total paid",
    "Months paid",
    "Months not paid",
  ];
  const lines: string[] = [
    `"${opts.chamaName.replace(/"/g, '""')} — ${potTitle} contribution summary"`,
    header.map((h) => `"${h}"`).join(","),
  ];

  const active = opts.members.filter((m) => m.role !== "New Applicant");
  for (const m of active) {
    const row = opts.totals[m.id] || {};
    let total = 0;
    let paidMonths = 0;
    let unpaidMonths = 0;
    const cells = opts.months.map((mk) => {
      const amt = Number(row[mk]) || 0;
      total += amt;
      if (amt > 0) paidMonths += 1;
      else unpaidMonths += 1;
      return amt > 0 ? String(amt) : "NOT PAID";
    });
    lines.push(
      [
        `"${(m.name || "").replace(/"/g, '""')}"`,
        `"${m.role || ""}"`,
        ...cells.map((c) => `"${c}"`),
        `"${total}"`,
        `"${paidMonths}"`,
        `"${unpaidMonths}"`,
      ].join(","),
    );
  }

  // BOM for Excel
  return "\uFEFF" + lines.join("\n");
}

export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
