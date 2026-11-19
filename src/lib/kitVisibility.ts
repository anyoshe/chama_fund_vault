import type { Chama } from "@/types/chama";
import { CHAMA_ACTIVITIES } from "@/types/chama";

export function getEnabledKitCodes(
  chama: Chama | null | undefined,
): string[] | null {
  const enabled = chama?.constitution?.enabledKitCodes;
  if (Array.isArray(enabled) && enabled.length > 0) {
    return enabled.map(String);
  }
  return null;
}

export function filterVisibleKits<T extends { kit_code: string }>(
  kits: T[],
  chama: Chama | null | undefined,
): T[] {
  const enabled = getEnabledKitCodes(chama);
  if (enabled == null) return kits;
  const set = new Set(enabled);
  return kits.filter((k) => set.has(k.kit_code));
}

export function potOptionsForChama(chama: Chama | null | undefined) {
  const enabled = getEnabledKitCodes(chama);
  if (enabled == null) return [...CHAMA_ACTIVITIES];
  const set = new Set(enabled);
  const fromList = CHAMA_ACTIVITIES.filter((a) => set.has(a.value));
  for (const code of enabled) {
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
