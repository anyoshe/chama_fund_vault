// Supabase Edge Function stub — Safaricom Daraja STK Push
// Deploy: supabase functions deploy payments
// Secrets: DARJA_CONSUMER_KEY, DARJA_CONSUMER_SECRET, DARJA_PASSKEY, DARJA_SHORTCODE, DARJA_CALLBACK_URL

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const path = new URL(req.url).pathname;

  if (path.endsWith("/stk-push") && req.method === "POST") {
    const body = await req.json();
    // TODO: OAuth + STK push against safaricom APIs using Deno env secrets
    return new Response(
      JSON.stringify({
        ok: false,
        message:
          "Daraja not configured. Set secrets and implement STK in this function, then set VITE_PAYMENT_MODE=live.",
        reference: body.reference ?? null,
      }),
      {
        status: 501,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  return new Response(JSON.stringify({ ok: true, service: "chamavault-payments" }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
