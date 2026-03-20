import { createClient } from '@supabase/supabase-js';

function runtimeEnv(name) {
  if (typeof import.meta !== 'undefined' && import.meta.env?.[name]) {
    return import.meta.env[name];
  }

  if (typeof process !== 'undefined' && process.env?.[name]) {
    return process.env[name];
  }

  return '';
}

export function getSupabaseConfig(options = {}) {
  const url = options.url || runtimeEnv('SUPABASE_URL') || runtimeEnv('VITE_SUPABASE_URL');
  const key =
    options.key ||
    runtimeEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    runtimeEnv('VITE_SUPABASE_ANON_KEY');

  return { url, key };
}

export function isSupabaseConfigured(options = {}) {
  const { url, key } = getSupabaseConfig(options);
  return Boolean(url && key);
}

export function createSupabaseClient(options = {}) {
  const { url, key } = getSupabaseConfig(options);

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
