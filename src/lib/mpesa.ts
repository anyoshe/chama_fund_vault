import { supabase } from "@/lib/supabase";

/** Initiate Daraja STK via Edge Function. Requires MPESA_* secrets configured. */
export async function initiateMpesaStk(params: {
  chamaId: string;
  amount: number;
  destination: string;
  phone: string;
  contributionId?: string;
}): Promise<{
  ok: boolean;
  contributionId?: string;
  customerMessage?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("mpesa-stk-push", {
    body: {
      chamaId: params.chamaId,
      amount: params.amount,
      destination: params.destination,
      phone: params.phone,
      contributionId: params.contributionId,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  if (data?.error) {
    return { ok: false, error: String(data.error) };
  }
  return {
    ok: true,
    contributionId: data?.contributionId,
    customerMessage: data?.customerMessage,
  };
}
