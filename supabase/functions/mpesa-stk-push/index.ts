/**
 * Supabase Edge Function: Initiate Safaricom Daraja STK Push
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   MPESA_CONSUMER_KEY
 *   MPESA_CONSUMER_SECRET
 *   MPESA_PASSKEY
 *   MPESA_SHORTCODE          (Paybill or Till)
 *   MPESA_ENV                (sandbox | production)
 *   MPESA_CALLBACK_URL       (https://<project>.supabase.co/functions/v1/mpesa-callback)
 *   SUPABASE_SERVICE_ROLE_KEY (auto in many setups)
 *
 * Body JSON: { chamaId, amount, destination, phone, contributionId? }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(phone: string): string {
  let p = phone.replace(/\D/g, "");
  if (p.startsWith("0")) p = "254" + p.slice(1);
  if (p.startsWith("+")) p = p.slice(1);
  if (!p.startsWith("254") && p.length === 9) p = "254" + p;
  return p;
}

async function getAccessToken(
  key: string,
  secret: string,
  env: string,
): Promise<string> {
  const base =
    env === "production"
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  const auth = btoa(`${key}:${secret}`);
  const res = await fetch(
    `${base}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token failed: ${t}`);
  }
  const json = await res.json();
  return json.access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    const consumerKey = Deno.env.get("MPESA_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("MPESA_CONSUMER_SECRET");
    const passkey = Deno.env.get("MPESA_PASSKEY");
    const shortcode = Deno.env.get("MPESA_SHORTCODE");
    const env = Deno.env.get("MPESA_ENV") || "sandbox";
    const callbackUrl = Deno.env.get("MPESA_CALLBACK_URL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!consumerKey || !consumerSecret || !passkey || !shortcode || !callbackUrl) {
      return new Response(
        JSON.stringify({
          error:
            "M-Pesa is not configured. Set MPESA_* secrets on Edge Functions.",
        }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const amount = Math.round(Number(body.amount));
    const phone = normalizePhone(String(body.phone || ""));
    const destination = String(body.destination || "general-savings");
    const chamaId = String(body.chamaId || "");
    let contributionId = body.contributionId as string | undefined;

    if (!chamaId || !amount || amount < 1 || phone.length < 12) {
      return new Response(
        JSON.stringify({ error: "chamaId, amount, and valid phone required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Ensure pending contribution exists
    if (!contributionId) {
      const ref = `STK-${crypto.randomUUID().slice(0, 10)}`;
      const { data: row, error: insErr } = await admin
        .from("contributions")
        .insert({
          chama_id: chamaId,
          member_id: user.id,
          amount,
          destination,
          method: "M-Pesa STK Push",
          phone,
          reference: ref,
          status: "pending",
          payment_date: new Date().toISOString().slice(0, 10),
          payment_details: "STK initiated",
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      contributionId = row.id;
    }

    const token = await getAccessToken(consumerKey, consumerSecret, env);
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);
    const password = btoa(`${shortcode}${passkey}${timestamp}`);
    const base =
      env === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    const stkBody = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: String(contributionId).slice(0, 12),
      TransactionDesc: `Chama ${destination}`.slice(0, 20),
    };

    const stkRes = await fetch(
      `${base}/mpesa/stkpush/v1/processrequest`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(stkBody),
      },
    );
    const stkJson = await stkRes.json();

    if (!stkRes.ok || stkJson.ResponseCode !== "0") {
      await admin
        .from("contributions")
        .update({
          status: "failed",
          payment_details: JSON.stringify(stkJson).slice(0, 500),
        })
        .eq("id", contributionId);
      return new Response(
        JSON.stringify({
          error: stkJson.errorMessage || stkJson.ResponseDescription || "STK failed",
          details: stkJson,
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Store CheckoutRequestID for callback match
    await admin
      .from("contributions")
      .update({
        payment_details: `CheckoutRequestID=${stkJson.CheckoutRequestID};MerchantRequestID=${stkJson.MerchantRequestID}`,
      })
      .eq("id", contributionId);

    // Optional: store mapping table
    await admin.from("mpesa_stk_requests").upsert(
      {
        contribution_id: contributionId,
        checkout_request_id: stkJson.CheckoutRequestID,
        merchant_request_id: stkJson.MerchantRequestID,
        phone,
        amount,
        chama_id: chamaId,
      },
      { onConflict: "checkout_request_id" },
    ).catch(() => null);

    return new Response(
      JSON.stringify({
        ok: true,
        contributionId,
        checkoutRequestId: stkJson.CheckoutRequestID,
        customerMessage:
          stkJson.CustomerMessage ||
          "Check your phone and enter M-Pesa PIN",
      }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
