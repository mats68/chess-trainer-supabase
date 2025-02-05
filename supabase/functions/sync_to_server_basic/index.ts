//sync_to_server_basic
import { createClient } from "jsr:@supabase/supabase-js@2";

interface DbItem {
  id: string;
  updatedAt: number;
  [key: string]: any;
}

enum UpdateTyp {
  Insert = 1,
  Update = 2,
  Delete = 3,
}

interface UpdateItem {
  id: string;
  table: "openings" | "chapters" | "variants" | "settings" | "deleteditems";
  u: UpdateTyp;
}

interface DeletedItem {
  id: string;
  tableName: "openings" | "chapters" | "variants";
  recordId: string;
  updatedAt: number;
}

interface SyncRequest {
  openings: DbItem[];
  chapters: DbItem[];
  settings: DbItem[];
  deleteditems: DeletedItem[];
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

      const syncData: SyncRequest = await req.json();

      // Hole aktuelle Userdaten
      const { data: currentData, error: fetchError } = await supabaseAdmin
        .from("user_data_basic")
        .select("*")
        .eq("user_id", user.id)
        .single();

      if (fetchError && fetchError.code !== "PGRST116") {
        throw fetchError;
      }
      const updateItems: UpdateItem[] = [];

      let newData;
      if (!currentData) {
        // Erster Sync - Einfach die neuen Daten nehmen
        newData = {
          openings: syncData.openings,
          chapters: syncData.chapters,
          settings: syncData.settings,
          deleteditems: syncData.deleteditems,
        };
      } else {
        for (const deleteItem of syncData.deleteditems) {
          if (deleteItem.tableName === "variants") {
            //Lösche Varianten
            const { error: deleteError } = await supabaseAdmin
              .from("user_data_variants")
              .delete()
              .eq("user_id", user.id)
              .eq("variant_id", deleteItem.recordId);

            if (deleteError) throw deleteError;
            updateItems.push({ id: deleteItem.recordId, table: "variants", u: UpdateTyp.Delete });            
          }
        }
        // Update existierender Daten
        newData = await mergeData(currentData, syncData, updateItems);
      }

      // Update oder Insert in die Datenbank
      const operation = currentData ? "update" : "insert";
      const query = supabaseAdmin.from("user_data_basic");

      const data = {
        user_id: user.id,
        ...newData,
        updated_at: new Date().toISOString(),
      };

      const { error: writeError } = operation === "insert" ? await query.insert(data) : await query.update(data).eq("user_id", user.id);

      if (writeError) throw writeError;

      return new Response(JSON.stringify({ data: { success: true, operation, updateItems } }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    } catch (error) {
      console.log(error);
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }
  })
);

async function mergeData(currentData: SyncRequest, syncData: SyncRequest, updateItems: UpdateItem[]) {
  // Initialisiere Arrays mit aktuellen Daten
  const mergedData = {
    openings: [...(currentData.openings || [])],
    chapters: [...(currentData.chapters || [])],
    settings: [...(currentData.settings || [])],
    deleteditems: [...(currentData.deleteditems || [])],
  };

  // Verarbeite gelöschte Items
  for (const deleteItem of syncData.deleteditems) {
    if (deleteItem.tableName !== "variants") {
      if (!currentData[deleteItem.tableName]) continue;
      const currentItems = mergedData[deleteItem.tableName];
      const existingItemIndex = currentItems.findIndex((item: DbItem) => item.id === deleteItem.recordId);
      if (existingItemIndex !== -1) {
        const existingItem = currentItems[existingItemIndex];
        if (deleteItem.updatedAt > existingItem.updatedAt) {
          updateItems.push({ id: existingItem.id, table: deleteItem.tableName, u: UpdateTyp.Delete });
          currentItems.splice(existingItemIndex, 1);
        }
      }
    } 
  }

  // Verarbeite Updates/Inserts für jede Tabelle
  for (const table of ["openings", "chapters", "settings", "deleteditems"] as const) {
    for (const newItem of syncData[table]) {
      const currentItems = mergedData[table];
      const existingItemIndex = currentItems.findIndex((item: DbItem) => item.id === newItem.id);

      let updateMoves = false;
      if (existingItemIndex !== -1) {
        const existingItem = currentItems[existingItemIndex];
        if (newItem.updatedAt > existingItem.updatedAt) {
          updateItems.push({ id: newItem.id, table: table, u: UpdateTyp.Update });
          currentItems[existingItemIndex] = newItem;
          updateMoves = true;
        }
      } else {
        updateItems.push({ id: newItem.id, table: table, u: UpdateTyp.Insert });
        currentItems.push(newItem);
        updateMoves = true;
      }
    }
  }

  // Lösche deleteditems die älter als ein Monat sind
  const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  mergedData.deleteditems = mergedData.deleteditems.filter((item) => item.updatedAt > oneMonthAgo);

  return mergedData;
}
