/**
 * Variáveis de ambiente do Supabase, validadas em um lugar só.
 *
 * Falha barulhenta no boot em vez de erro silencioso e confuso lá na frente.
 * Só a chave `anon` mora aqui — a `service_role` jamais entra em NEXT_PUBLIC_*.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY em app-web/.env.local ' +
      '(use .env.example como modelo) e reinicie o `npm run dev`.',
  );
}

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;
