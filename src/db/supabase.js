const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[WARN] Supabase credentials not found in environment variables');
  console.warn('[WARN] Database features will be disabled');
}

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: true, persistSession: false },
    })
  : null;

const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

let _connectionHealthy = false;

function isConfigured() {
  return supabaseAdmin !== null;
}

async function testConnection() {
  if (!supabaseAdmin) {
    _connectionHealthy = false;
    return { connected: false, error: 'Supabase not configured' };
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('count')
      .limit(1);
    if (error && error.code !== 'PGRST116') throw error;
    _connectionHealthy = true;
    return { connected: true, error: null };
  } catch (error) {
    _connectionHealthy = false;
    return { connected: false, error: error.message };
  }
}

function isAvailable() {
  return supabaseAdmin !== null && _connectionHealthy;
}

module.exports = { supabase, supabaseAdmin, testConnection, isAvailable, isConfigured };