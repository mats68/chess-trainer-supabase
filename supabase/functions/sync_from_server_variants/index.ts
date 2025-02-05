//sync_from_server_variants
import { createClient } from "jsr:@supabase/supabase-js@2";

interface SyncRequest {
  last_sync_time: string;
  batch_size: number;
  offset?: number;
}

async function corsHandler(req: Request, handler: (req: Request) => Promise<Response>) {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const response = await handler(req);
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

Deno.serve((req) =>
  corsHandler(req, async (req) => {
    try {
      const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

      const authHeader = req.headers.get("Authorization")!;
      const {
        data: { user },
        error: userError,
      } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));

      if (userError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }

      const { last_sync_time, batch_size, offset = 0 } = (await req.json()) as SyncRequest;

      // Hole die Gesamtanzahl der zu synchronisierenden Varianten
      const { count: totalCount } = await supabaseAdmin
        .from("user_data_variants")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gt("updated_at", parseInt(last_sync_time));

      // Hole den aktuellen Batch mit offset
      const { data: variants, error: fetchError } = await supabaseAdmin
        .from("user_data_variants")
        .select("*")
        .eq("user_id", user.id)
        .gt("updated_at", parseInt(last_sync_time))
        .order("id", { ascending: true }) // Sortiere nach id statt updated_at
        .range(offset, offset + batch_size - 1);

      if (fetchError) throw fetchError;

      const hasMore = totalCount > (offset + (variants?.length || 0));
      const nextOffset = offset + batch_size;

      return new Response(
        JSON.stringify({
          data: {
            variants: variants || [],
            has_more: hasMore,
            next_offset: hasMore ? nextOffset : null,
            total_count: totalCount,
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }
      );
    } catch (error) {
      console.error("Error in sync from server:", error);
      return new Response(
        JSON.stringify({
          error: error.message,
          code: error.code,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: error.status || 400,
        }
      );
    }
  })
);
