'use client';

/**
 * Troca de funil. A organização pode ter vários (Matrículas, Reativação,
 * Campanha de verão) e o quadro mostra um por vez.
 *
 * Navega por URL em vez de guardar estado: assim o funil escolhido sobrevive
 * ao refresh e pode ser compartilhado por link com um colega.
 */
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { FunilResumo } from '@/lib/crm/tipos';

export function SeletorFunil({ funis, atual }: { funis: FunilResumo[]; atual: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();

  if (funis.length < 2) return null;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-texto-2">Funil</span>
      <select
        value={atual}
        disabled={pendente}
        onChange={(evento) => {
          const id = evento.target.value;
          iniciar(() => router.push(`/kanban?funil=${encodeURIComponent(id)}`));
        }}
        className="rounded-padrao border border-linha-forte bg-transparent px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {funis.map((funil) => (
          <option key={funil.id} value={funil.id}>
            {funil.nome}
            {funil.padrao ? ' (padrão)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
