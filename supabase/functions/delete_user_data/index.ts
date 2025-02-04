import { createClient } from "jsr:@supabase/supabase-js@2"

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


Deno.serve((req) => corsHandler(req, async (req) => {
  try {
    // Initialisiere den Supabase Admin Client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Extrahiere den Auth Token aus dem Header und hole den User
    const authHeader = req.headers.get('Authorization')!;
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    // Überprüfe Authentifizierung
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { 
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Lösche die user_data des authentifizierten Users
    const { error: deleteError } = await supabaseAdmin
      .from('user_data_basic')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      throw deleteError;
    }

    const { error: deleteError_variants } = await supabaseAdmin
      .from('user_data_variants')
      .delete()
      .eq('user_id', user.id);

    if (deleteError_variants) {
      throw deleteError_variants;
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'User data successfully deleted'
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        error: error.message || 'An error occurred while deleting user data'
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
}));