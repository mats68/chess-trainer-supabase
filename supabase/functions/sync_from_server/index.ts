import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.5.0";


interface DbItem {
  id: string;
  updatedAt: string;
  [key: string]: any;
}

interface UserData {
  openings: DbItem[];
  chapters: DbItem[];
  variants: DbItem[];
  moves: DbItem[];
  settings: DbItem[];
  deleteditems: DbItem[];
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
    // Erstelle Supabase Admin Client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Authentifiziere den Benutzer
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

    // Hole last_sync_time aus der Anfrage
    const { last_sync_time } = await req.json();
    if (!last_sync_time) {
      return new Response(
        JSON.stringify({ error: 'Last sync time is required' }),
        { status: 400 }
      );
    }

    // Hole Benutzerdaten
    const { data: userData, error: fetchError } = await supabaseAdmin
      .from('user_data')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        // Keine Daten gefunden - gebe leere Daten zurück
        return new Response(
          JSON.stringify({ 
            data: {
              openings: [],
              chapters: [],
              variants: [],
              moves: [],
              settings: [],
              deleteditems: []
            }
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200 
          }
        );
      }
      throw fetchError;
    }

    // Falls keine Daten oder kein Update seit letzter Synchronisation
    if (!userData) {
      return new Response(
        JSON.stringify({ data: null }),
        {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        }
      );
    }

    // Erstelle Response-Objekt mit allen geänderten Daten
    const responseData: UserData = {
      openings: userData.openings || [],
      chapters: userData.chapters || [],
      variants: userData.variants || [],
      moves: userData.moves || [],
      settings: userData.settings || [],
      deleteditems: userData.deleteditems || [],
    };

    responseData.openings = responseData.openings.filter(o => new Date(o.updatedAt) > new Date(last_sync_time))
    responseData.chapters = responseData.chapters.filter(o => new Date(o.updatedAt) > new Date(last_sync_time))
    responseData.variants = responseData.variants.filter(o => new Date(o.updatedAt) > new Date(last_sync_time))
    const moves: DbItem[] = []
    for (const variant of responseData.variants) {
      const v_moves = responseData.moves.filter(m => m.variantId === variant.id)
      moves.push(...v_moves)
    }
    responseData.moves = moves;
    responseData.settings = responseData.settings.filter(o => new Date(o.updatedAt) > new Date(last_sync_time))
    responseData.deleteditems = responseData.deleteditems.filter(o => new Date(o.updatedAt) > new Date(last_sync_time))

    return new Response(
      JSON.stringify({ data: responseData }),
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
        status: 500
      }
    );
  }
}));