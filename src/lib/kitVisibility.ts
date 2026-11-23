import type { Chama } from "@/types/chama";
import { CHAMA_ACTIVITIES } from "@/types/chama";

/** Mistaken duplicate of welfare — never show or select as a pot */
export function isRetiredWelfareExpenseKit(
  code: string,
  label?: string | null,
): boolean {
  const c = (code || "").toLowerCase();
  const l = (label || "").toLowerCase();
  if (c === "welfare") return false;
  return (
    /welfare.*(run|expens)/.test(c) ||
    /run.*expens/.test(c) ||
    /welfare.*(run|expens)/.test(l) ||
    /run.*expens/.test(l) ||
    [
      "welfare-running-expenses",
      "welfare-running-expenses-account",
      "welfare_running_expenses",
      "welfare-running-expenses-accoutn",
    ].includes(c)
  );
}

/** Map old running-expense destinations to standard welfare */
export function normalizeKitDestination(destination: string): string {
  if (isRetiredWelfareExpenseKit(destination, destination)) return "welfare";
  return destination;
}

export function getEnabledKitCodes(
  chama: Chama | null | undefined,
): string[] | null {
  const enabled = chama?.constitution?.enabledKitCodes;
  if (Array.isArray(enabled) && enabled.length > 0) {
    return enabled.map(String).filter((c) => !isRetiredWelfareExpenseKit(c));
  }
  return null;
}

export function filterVisibleKits<
  T extends { kit_code: string; label?: string },
>(kits: T[], chama: Chama | null | undefined): T[] {
  const withoutRetired = kits.filter(
    (k) => !isRetiredWelfareExpenseKit(k.kit_code, k.label),
  );
  const enabled = getEnabledKitCodes(chama);
  if (enabled == null) return withoutRetired;
  const set = new Set(enabled);
  return withoutRetired.filter((k) => set.has(k.kit_code));
}

export function potOptionsForChama(chama: Chama | null | undefined) {
  const enabled = getEnabledKitCodes(chama);
  // Only activated pots — never the full catalogue when the chama has a list
  if (enabled != null && enabled.length > 0) {
    const set = new Set(enabled);
    const fromList = CHAMA_ACTIVITIES.filter((a) => set.has(a.value));
    for (const code of enabled) {
      if (isRetiredWelfareExpenseKit(code)) continue;
      if (!fromList.some((a) => a.value === code)) {
        fromList.push({
          value: code as (typeof CHAMA_ACTIVITIES)[number]["value"],
          label: labelForKitCode(code),
          description: "",
        });
      }
    }
    return fromList;
  }
  // No enabledKitCodes saved yet → show standard list (chair should set pots in Settings)
  return [...CHAMA_ACTIVITIES];
}

function labelForKitCode(code: string): string {
  const known = CHAMA_ACTIVITIES.find((a) => a.value === code);
  if (known) return known.label;
  return code
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Options limited to kits present on the group book AND enabled (if set) */
export function potOptionsFromKits(
  chama: Chama | null | undefined,
  kits: { kit_code: string; label?: string }[],
) {
  const visible = filterVisibleKits(kits, chama);
  if (visible.length > 0) {
    return visible.map((k) => ({
      value: k.kit_code,
      label: k.label || labelForKitCode(k.kit_code),
    }));
  }
  return potOptionsForChama(chama).map((p) => ({
    value: p.value,
    label: p.label,
  }));
}
