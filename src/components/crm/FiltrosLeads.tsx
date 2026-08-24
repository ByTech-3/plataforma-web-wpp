'use client';

/**
 * Barra de filtros e busca.
 *
 * O estado vive na URL, não no componente. Assim o vendedor pode guardar o
 * link de "meus leads do Instagram na etapa Negociação", voltar nele amanhã e
 * mandar para o gestor — e o botão voltar do navegador funciona.
 *
 * Os mesmos filtros servem à listagem e ao Kanban; a etapa só aparece na
 * listagem, porque no quadro as etapas JÁ SÃO as colunas.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CAMPO } from '@/components/ui';
import { ORIGENS_LEAD, type MembroOrg, type TagLead } from '@/lib/crm/tipos';

type EtapaFiltro = { id: string; nome: string; funil: string };

type Props = {
  membros: MembroOrg[];
  tags: TagLead[];
  etapas?: EtapaFiltro[];
  /** Quantos leads o filtro atual devolveu, para o vendedor se situar. */
  total: number;
};

const CAMPO_MENOR = `${CAMPO} py-1.5 text-sm`;

export function FiltrosLeads({ membros, tags, etapas, total }: Props) {
  const router = useRouter();
  const caminho = usePathname();
  const parametros = useSearchParams();

  const [busca, setBusca] = useState(parametros.get('busca') ?? '');
  const relogio = useRef<number | null>(null);

  function trocar(chave: string, valor: string) {
    const novos = new URLSearchParams(parametros.toString());
    if (valor) novos.set(chave, valor);
    else novos.delete(chave);

    const query = novos.toString();
    router.replace(query ? `${caminho}?${query}` : caminho, { scroll: false });
  }

  // A busca espera o vendedor parar de digitar: sem isso, cada tecla viraria
  // uma navegação e uma consulta ao banco.
  useEffect(() => {
    const atual = parametros.get('busca') ?? '';
    if (busca === atual) return;

    if (relogio.current) window.clearTimeout(relogio.current);
    relogio.current = window.setTimeout(() => trocar('busca', busca.trim()), 400);

    return () => {
      if (relogio.current) window.clearTimeout(relogio.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca]);

  const ativos = ['responsavel', 'origem', 'tag', 'etapa', 'busca'].filter((chave) =>
    parametros.get(chave),
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={busca}
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar por nome ou telefone"
          className={`${CAMPO_MENOR} w-full sm:w-64`}
          aria-label="Buscar por nome ou telefone"
        />

        <select
          value={parametros.get('responsavel') ?? ''}
          onChange={(evento) => trocar('responsavel', evento.target.value)}
          className={`${CAMPO_MENOR} w-auto`}
          aria-label="Filtrar por responsável"
        >
          <option value="">Todos os responsáveis</option>
          <option value="sem">Sem responsável</option>
          {membros.map((membro) => (
            <option key={membro.user_id} value={membro.user_id}>
              {membro.nome}
            </option>
          ))}
        </select>

        <select
          value={parametros.get('origem') ?? ''}
          onChange={(evento) => trocar('origem', evento.target.value)}
          className={`${CAMPO_MENOR} w-auto`}
          aria-label="Filtrar por origem"
        >
          <option value="">Todas as origens</option>
          {ORIGENS_LEAD.map((origem) => (
            <option key={origem} value={origem}>
              {origem}
            </option>
          ))}
        </select>

        <select
          value={parametros.get('tag') ?? ''}
          onChange={(evento) => trocar('tag', evento.target.value)}
          className={`${CAMPO_MENOR} w-auto`}
          aria-label="Filtrar por etiqueta"
        >
          <option value="">Todas as etiquetas</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.nome}
            </option>
          ))}
        </select>

        {etapas && (
          <select
            value={parametros.get('etapa') ?? ''}
            onChange={(evento) => trocar('etapa', evento.target.value)}
            className={`${CAMPO_MENOR} w-auto`}
            aria-label="Filtrar por etapa"
          >
            <option value="">Todas as etapas</option>
            {etapas.map((etapa) => (
              <option key={etapa.id} value={etapa.id}>
                {etapa.funil} › {etapa.nome}
              </option>
            ))}
          </select>
        )}

        {ativos > 0 && (
          <button
            type="button"
            onClick={() => {
              setBusca('');
              router.replace(caminho, { scroll: false });
            }}
            className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Limpar filtros ({ativos})
          </button>
        )}
      </div>

      {ativos > 0 && (
        <p className="text-xs text-neutral-500" aria-live="polite">
          {total} {total === 1 ? 'lead encontrado' : 'leads encontrados'} com os filtros atuais.
        </p>
      )}
    </div>
  );
}
