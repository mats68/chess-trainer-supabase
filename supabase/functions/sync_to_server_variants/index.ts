//sync_to_server_variants
import { createClient } from "jsr:@supabase/supabase-js@2";

interface DbItem {
  id: string;
  updatedAt: number;
  [key: string]: any;
}

interface VariantSync {
  variant: DbItem;
  moves: DbItem[];
}

interface VariantSyncRequest {
  variants: VariantSync[];
}

async function corsHandler(req: Request, handler: (req: Request) => Promise<Response>) {
  // Handle OPTIONS request for CORS preflight
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

  // Handle actual request
  const response = await handler(req);

  // Add CORS headers to response
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

      const { variants }: VariantSyncRequest = await req.json();

      for (const variantSync of variants) {
        const { data: existingVariant } = await supabaseAdmin
          .from("user_data_variants")
          .select("updated_at")
          .eq("user_id", user.id)
          .eq("variant_id", variantSync.variant.id)
          .single();

        if (existingVariant) {
          // Update
          //todo check if (variantSync.variant.updatedAt > existingVariant.updated_at)
          if (variantSync.variant.updatedAt > existingVariant.updated_at) {
            const { error: variantError } = await supabaseAdmin
              .from("user_data_variants")
              .update({
                variant: variantSync.variant,
                moves: variantSync.moves,
                updated_at: variantSync.variant.updatedAt,
              })
              .eq("user_id", user.id)
              .eq("variant_id", variantSync.variant.id);

            if (variantError) {
              console.log(variantError);
              throw variantError;
            }
          }
        } else {
          // Insert
          const { error: variantError } = await supabaseAdmin.from("user_data_variants").insert({
            user_id: user.id,
            variant_id: variantSync.variant.id,
            variant: variantSync.variant,
            moves: variantSync.moves,
            updated_at: variantSync.variant.updatedAt,
          });

          if (variantError) {
            console.log(variantError);
            throw variantError;
          }
        }
      }

      return new Response(
        JSON.stringify({
          data: {
            success: true,
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }
      );
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }
  })
);
