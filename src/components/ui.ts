/** Classes Tailwind compartilhadas, para as telas não divergirem entre si. */

export const CAMPO =
  'w-full rounded-md border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-sm ' +
  'outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 ' +
  'disabled:opacity-60';

export const ROTULO = 'block text-sm font-medium mb-1.5';

export const BOTAO_PRIMARIO =
  'w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition ' +
  'hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export const CARTAO =
  'rounded-xl border border-black/10 dark:border-white/15 p-6';

export const ERRO =
  'rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-400';

export const AVISO =
  'rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-400';

export const SUCESSO =
  'rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 dark:text-emerald-400';
