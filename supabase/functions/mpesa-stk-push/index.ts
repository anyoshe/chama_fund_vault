/**
 * Daraja STK Push — uses per-chama credentials from chama_mpesa_credentials
 * (saved in Chama Finance → Settings). Falls back to MPESA_* Edge secrets.
 *
 * Body: { chamaId, amount, destination, phone, contributionId? }
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const callbackUrl =
      Deno.env.get("MPESA_CALLBACK_URL") ||
      `${supabaseUrl}/functions/v1/mpesa-callback`;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey || serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const chamaId = body.chamaId as string;
    const amount = Number(body.amount);
    const destination = String(body.destination || "general-savings");
    const phone = normalizePhone(String(body.phone || ""));
    let contributionId = body.contributionId as string | undefined;

    if (!chamaId || !amount || amount < 1 || phone.length < 12) {
      return new Response(
        JSON.stringify({ error: "chamaId, amount and valid phone required" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Load per-chama Daraja credentials
    const { data: credJson } = await admin.rpc(
      "get_chama_mpesa_credentials_internal",
      { p_chama_id: chamaId },
    );

    let consumerKey = credJson?.consumerKey as string | undefined;
    let consumerSecret = credJson?.consumerSecret as string | undefined;
    let passkey = credJson?.passkey as string | undefined;
    let shortcode = credJson?.shortcode as string | undefined;
    let env = (credJson?.environment as string) || "sandbox";
    let accountRef =
      (credJson?.accountReference as string) || shortcode || "ChamaVault";
    let txDesc = (credJson?.transactionDesc as string) || "ChamaVault";

    // Fallback to project-level secrets
    if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
      consumerKey = Deno.env.get("MPESA_CONSUMER_KEY") || consumerKey;
      consumerSecret = Deno.env.get("MPESA_CONSUMER_SECRET") || consumerSecret;
      passkey = Deno.env.get("MPESA_PASSKEY") || passkey;
      shortcode = Deno.env.get("MPESA_SHORTCODE") || shortcode;
      env = Deno.env.get("MPESA_ENV") || env;
    }

    if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
      return new Response(
        JSON.stringify({
          error:
            "M-Pesa credentials not set for this chama. Chair/Treasurer: Chama Finance → Settings → M-Pesa setup.",
        }),
        { status: 503, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // Ensure pending contribution exists
    if (!contributionId) {
      const {
        data: { user },
      } = await userClient.auth.getUser();
      if (!user) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 401,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const ref = `STK${Date.now().toString().slice(-10)}`;
      const { data: ins, error: insErr } = await admin
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
          payment_details: "STK initiated",
          created_by: user.id,
        })
        .select("id")
        .single();
      if (insErr) {
        return new Response(JSON.stringify({ error: insErr.message }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      contributionId = ins.id;
    }

    const token = await getAccessToken(consumerKey, consumerSecret, env);
    const base =
      env === "production"
        ? "https://api.safaricom.co.ke"
        : "https://sandbox.safaricom.co.ke";

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);
    const password = btoa(`${shortcode}${passkey}${timestamp}`);

    const stkRes = await fetch(`${base}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.round(amount),
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: String(accountRef).slice(0, 12),
        TransactionDesc: String(txDesc).slice(0, 13),
      }),
    });

    const stkJson = await stkRes.json();
    if (!stkRes.ok || stkJson.ResponseCode !== "0") {
      await admin
        .from("contributions")
        .update({ status: "failed", payment_details: JSON.stringify(stkJson) })
        .eq("id", contributionId);
      return new Response(
        JSON.stringify({
          error:
            stkJson.errorMessage ||
            stkJson.ResponseDescription ||
            "STK failed",
          details: stkJson,
        }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    await admin
      .from("contributions")
      .update({
        payment_details: `CheckoutRequestID=${stkJson.CheckoutRequestID};MerchantRequestID=${stkJson.MerchantRequestID}`,
      })
      .eq("id", contributionId);

    await admin.from("mpesa_stk_requests").upsert(
      {
        contribution_id: contributionId,
        checkout_request_id: stkJson.CheckoutRequestID,
        merchant_request_id: stkJson.MerchantRequestID,
        phone,
        amount,
        chama_id: chamaId,
        status: "pending",
      },
      { onConflict: "checkout_request_id" },
    );

    return new Response(
      JSON.stringify({
        ok: true,
        contributionId,
        checkoutRequestId: stkJson.CheckoutRequestID,
        customerMessage:
          stkJson.CustomerMessage || "Check your phone and enter M-Pesa PIN",
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
