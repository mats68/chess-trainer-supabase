import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

serve(async (req) => {
  return new Response(JSON.stringify({ message: "Hello from Supabase Edge Functions via Dashboard!" }), {
    headers: { "Content-Type": "application/json" },
  });
});
