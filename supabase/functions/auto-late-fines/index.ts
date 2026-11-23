/**
 * Daily late-fine job. Schedule with Supabase Cron:
 *   select cron.schedule('chamavault-late-fines', '0 3 * * *', $$
 *     select net.http_post(
 *       url := 'https://<project>.supabase.co/functions/v1/auto-late-fines',
 *       headers := '{"Authorization": "Bearer <service_role>"}'::jsonb
 *     );
 *   $$);
 *
 * Or Dashboard → Edge Functions → Schedules: daily 03:00 UTC
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await admin.rpc("auto_assess_late_fines_all_chamas");
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true, data }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500 },
    );
  }
});
