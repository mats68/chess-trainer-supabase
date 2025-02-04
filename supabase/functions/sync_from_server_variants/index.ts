//sync_from_server_variants
import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH_SIZE = 50; // Anzahl der Varianten pro Batch

interface SyncRequest {
  last_sync_time: string;
  batch_size?: number; // Optional - erlaubt Client die Batch-Größe anzupassen
  last_batch_id?: string; // Für Pagination - UUID der letzten Variante vom vorherigen Batch
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

      const { last_sync_time, batch_size = BATCH_SIZE, last_batch_id } = (await req.json()) as SyncRequest;

      let query = supabaseAdmin
        .from("user_data_variants")
        .select("*")
        .eq("user_id", user.id)
        .gt("updated_at", parseInt(last_sync_time))
        .order("updated_at", { ascending: true })
        .limit(batch_size);

      // Wenn last_batch_id vorhanden, starte nach diesem Datensatz
      if (last_batch_id) {
        const { data: lastItem } = await supabaseAdmin.from("user_data_variants").select("updated_at").eq("id", last_batch_id).single();

        if (lastItem) {
          query = query.gt("updated_at", lastItem.updated_at);
        }
      }

      const { data: variants, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      // Prüfe ob es noch mehr Daten gibt
      const { count: totalCount } = await supabaseAdmin
        .from("user_data_variants")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gt("updated_at", parseInt(last_sync_time));

      const hasMore = totalCount > (variants?.length || 0) + (last_batch_id ? batch_size : 0);
      const lastId = variants && variants.length > 0 ? variants[variants.length - 1].id : null;

      return new Response(
        JSON.stringify({
          data: {
            variants: variants || [],
            has_more: hasMore,
            last_batch_id: lastId,
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
