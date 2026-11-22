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
  if (enabled == null) return [...CHAMA_ACTIVITIES];
  const set = new Set(enabled);
  const fromList = CHAMA_ACTIVITIES.filter((a) => set.has(a.value));
  for (const code of enabled) {
    if (isRetiredWelfareExpenseKit(code)) continue;
    // welfare-fines is a sub-pot of welfare
    if (!fromList.some((a) => a.value === code)) {
      fromList.push({
        value: code as (typeof CHAMA_ACTIVITIES)[number]["value"],
        label: code,
        description: "",
      });
    }
  }
  return fromList.length ? fromList : [...CHAMA_ACTIVITIES];
}
