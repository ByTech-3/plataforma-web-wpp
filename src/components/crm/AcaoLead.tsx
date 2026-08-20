'use client';

/**
 * Botão de ação de um clique só (arquivar, restaurar, entrar no funil).
 *
 * Existe como componente próprio por um motivo: a recusa do banco precisa
 * aparecer na tela. Um `<form action={...}>` puro engoliria o erro em silêncio
 * e o usuário ficaria achando que arquivou — quando a licença vencida fez o
 * banco recusar.
 */
import { useActionState } from 'react';
import { ERRO } from '@/components/ui';
import { ESTADO_ACAO_INICIAL, type EstadoAcao } from '@/lib/crm/tipos';

type Props = {
  acao: (estado: EstadoAcao, dados: FormData) => Promise<EstadoAcao>;
  campos: Record<string, string>;
  rotulo: string;
  rotuloEnviando: string;
  variante?: 'neutro' | 'destaque';
  className?: string;
};

const ESTILOS = {
  neutro:
    'rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition ' +
    'hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10',
  destaque:
    'rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition ' +
    'hover:bg-emerald-700 disabled:opacity-60',
};

export function AcaoLead({
  acao,
  campos,
  rotulo,
  rotuloEnviando,
  variante = 'neutro',
  className = '',
}: Props) {
  const [estado, enviar, enviando] = useActionState(acao, ESTADO_ACAO_INICIAL);

  return (
    <form action={enviar} className={className}>
      {Object.entries(campos).map(([nome, valor]) => (
        <input key={nome} type="hidden" name={nome} value={valor} />
      ))}

      <button type="submit" className={ESTILOS[variante]} disabled={enviando}>
        {enviando ? rotuloEnviando : rotulo}
      </button>

      {estado.erro && <p className={`${ERRO} mt-3`}>{estado.erro}</p>}
    </form>
  );
}
