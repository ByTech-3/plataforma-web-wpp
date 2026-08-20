'use client';

import Link from 'next/link';
import { CARTAO, ERRO } from '@/components/ui';

/**
 * Falha inesperada dentro do CRM (banco fora do ar, sessão expirada no meio da
 * navegação, consulta recusada). Melhor uma tela que explica e oferece saída do
 * que a tela de erro genérica.
 */
export default function ErroCrm({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className={`mx-auto max-w-lg ${CARTAO}`}>
      <h1 className="text-lg font-semibold">Não foi possível carregar o CRM</h1>
      <p className={`mt-3 ${ERRO}`}>{error.message}</p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          Tentar de novo
        </button>
        <Link
          href="/dashboard"
          className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
        >
          Ir para o painel
        </Link>
      </div>
    </div>
  );
}
