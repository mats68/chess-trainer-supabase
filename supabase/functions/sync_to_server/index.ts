import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";

interface DbItem {
  id: string;
  updatedAt: number;
  [key: string]: any;
}

interface DeletedItem {
  id: string;
  tableName: string;
  recordId: string;
  updatedAt: number;
}

interface SyncRequest {
  openings: DbItem[];
  chapters: DbItem[];
  variants: DbItem[];
  moves: DbItem[];
  settings: DbItem[];
  deleteditems: DeletedItem[];
}

async function corsHandler(req: Request, handler: (req: Request) => Promise<Response>) {
  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Handle actual request
  const response = await handler(req);
  
  // Add CORS headers to response
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

serve((req) => corsHandler(req, async (req) => {
  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization')!;
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401 }
      );
    }

    const syncData: SyncRequest = await req.json();

    // Hole aktuelle Userdaten
    const { data: currentData, error: fetchError } = await supabaseAdmin
      .from('user_data')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') {
      throw fetchError;
    }

    let newData;
    if (!currentData) {
      // Erster Sync - Einfach die neuen Daten nehmen
      newData = {
        openings: syncData.openings,
        chapters: syncData.chapters,
        variants: syncData.variants,
        moves: syncData.moves,
        settings: syncData.settings,
        deleteditems: syncData.deleteditems
      };
    } else {
      // Update existierender Daten
      newData = mergeData(currentData, syncData);
    }

    // Update oder Insert in die Datenbank
    const operation = currentData ? 'update' : 'insert';
    const query = supabaseAdmin.from('user_data');

    const data = {
      user_id: user.id,
      ...newData,
      updated_at: new Date().toISOString()
    };

    const { error: writeError } = operation === 'insert'
      ? await query.insert(data)
      : await query.update(data).eq('user_id', user.id);

    if (writeError) throw writeError;

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
}));

function mergeData(currentData: SyncRequest, syncData: SyncRequest) {
  // Initialisiere Arrays mit aktuellen Daten
  const mergedData = {
    openings: [...(currentData.openings || [])],
    chapters: [...(currentData.chapters || [])],
    variants: [...(currentData.variants || [])],
    moves: [...(currentData.moves || [])],
    settings: [...(currentData.settings || [])],
    deleteditems: [...(currentData.deleteditems || [])]
  };

  // Verarbeite gelöschte Items
  for (const deleteItem of syncData.deleteditems) {
    if (!currentData[deleteItem.tableName]) continue;

    const currentItems = mergedData[deleteItem.tableName];
    const existingItemIndex = currentItems.findIndex(
      (item: DbItem) => item.id === deleteItem.recordId
    );

    if (existingItemIndex !== -1) {
      const existingItem = currentItems[existingItemIndex];
      if (deleteItem.updatedAt > existingItem.updatedAt) {
        currentItems.splice(existingItemIndex, 1);
      }
    }
  }

  let moves = (currentData.moves || [])

  // Verarbeite Updates/Inserts für jede Tabelle
  for (const table of ['openings', 'chapters', 'variants', 'settings'] as const) {
    for (const newItem of syncData[table]) {
      const currentItems = mergedData[table];
      const existingItemIndex = currentItems.findIndex(
        (item: DbItem) => item.id === newItem.id
      );

      let updateMoves = false;
      if (existingItemIndex !== -1) {
        const existingItem = currentItems[existingItemIndex];
        if (newItem.updatedAt > existingItem.updatedAt) {
          currentItems[existingItemIndex] = newItem;
          updateMoves = true;
        }
      } else {
        currentItems.push(newItem);
        updateMoves = true;
      }

      // Die alten moves durch die neuen ersetzen
      if (table === 'variants' && updateMoves) {
        moves = moves.filter(m => m.variantId !== newItem.id);
        const newMoves = syncData['moves'].filter(m => m.variantId === newItem.id)
        moves.push(...newMoves)
      }
    }
  }

  mergedData.moves = moves

  return mergedData;
}