/**
 * Safaricom Daraja STK callback.
 * Configure MPESA_CALLBACK_URL to this function URL (no user JWT required).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const callback = body?.Body?.stkCallback;
    if (!callback) {
      return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const resultCode = Number(callback.ResultCode);
    const checkoutId = callback.CheckoutRequestID as string;
    const merchantId = callback.MerchantRequestID as string;

    let contributionId: string | null = null;
    let mpesaReceipt: string | null = null;

    const { data: mapRow } = await admin
      .from("mpesa_stk_requests")
      .select("contribution_id")
      .eq("checkout_request_id", checkoutId)
      .maybeSingle();

    if (mapRow?.contribution_id) {
      contributionId = mapRow.contribution_id;
    }

    if (resultCode === 0 && callback.CallbackMetadata?.Item) {
      const items = callback.CallbackMetadata.Item as {
        Name: string;
        Value?: string | number;
      }[];
      for (const it of items) {
        if (it.Name === "MpesaReceiptNumber") {
          mpesaReceipt = String(it.Value);
        }
      }
    }

    if (!contributionId) {
      // Fallback: AccountReference was contribution id slice
      const accRef = itemsAccountRef(callback);
      if (accRef) contributionId = accRef;
    }

    if (contributionId) {
      if (resultCode === 0) {
        const { error } = await admin.rpc("complete_mpesa_contribution", {
          p_contribution_id: contributionId,
          p_mpesa_receipt: mpesaReceipt || checkoutId,
        });
        if (error) {
          console.error("complete_mpesa_contribution", error);
        }
        await admin
          .from("mpesa_stk_requests")
          .update({ status: "completed", mpesa_receipt: mpesaReceipt })
          .eq("checkout_request_id", checkoutId);
      } else {
        await admin
          .from("contributions")
          .update({
            status: "failed",
            payment_details: `STK failed: ${callback.ResultDesc || resultCode}`,
          })
          .eq("id", contributionId);
        await admin
          .from("mpesa_stk_requests")
          .update({ status: "failed", result_desc: callback.ResultDesc })
          .eq("checkout_request_id", checkoutId);
      }
    }

    // Safaricom expects 200
    return new Response(
      JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});

function itemsAccountRef(callback: {
  CallbackMetadata?: { Item?: { Name: string; Value?: string | number }[] };
}): string | null {
  // Not always present; mapping table is primary
  return null;
}
