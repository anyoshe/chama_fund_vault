import { supabase } from "@/lib/supabase";

export type PayPollStatus = "pending" | "completed" | "failed" | "rejected" | "timeout";

/** Poll contribution until completed/failed or timeout (default 90s). */
export async function pollContributionStatus(
  contributionId: string,
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<PayPollStatus> {
  const intervalMs = opts?.intervalMs ?? 2500;
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase
      .from("contributions")
      .select("status")
      .eq("id", contributionId)
      .maybeSingle();

    if (!error && data?.status) {
      const s = String(data.status);
      if (s === "completed" || s === "confirmed") return "completed";
      if (s === "failed" || s === "rejected") return "failed";
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return "timeout";
}
