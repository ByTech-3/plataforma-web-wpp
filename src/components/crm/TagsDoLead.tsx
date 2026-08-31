'use client';

/**
 * Etiquetas de um lead: aplicar, criar na hora e remover.
 *
 * Criar sem sair da tela é o ponto: quem está com a ficha aberta e precisa de
 * "Aluno antigo" não deveria ter que ir às configurações, cadastrar e voltar.
 * Se a etiqueta já existir com outro caso de letra, o servidor aproveita a
 * existente em vez de recusar.
 *
 * Não registra nada em `activities`: os triggers do banco já gravam
 * `tag.added` e `tag.removed`.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { aplicarTag, removerTag } from '@/lib/crm/acoes-tags';
import { COR_PADRAO_TIPO, type EstadoAcao, type TagLead } from '@/lib/crm/tipos';

type Props = {
  leadId: string;
  /** Etiquetas já aplicadas neste lead. */
  aplicadas: TagLead[];
  /** Todas as da organização, para o seletor. */
  disponiveis: TagLead[];
  compacto?: boolean;
};

const COR_NOVA = COR_PADRAO_TIPO.aberta;

export function TagsDoLead({ leadId, aplicadas, disponiveis, compacto = false }: Props) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState('');
  const [abrindo, setAbrindo] = useState(false);
  const [pendente, iniciar] = useTransition();

  function executar(acao: () => Promise<EstadoAcao>) {
    setErro(null);
    iniciar(async () => {
      const resultado = await acao();
      if (resultado.erro) setErro(resultado.erro);
      else router.refresh();
    });
  }

  const naoAplicadas = disponiveis.filter(
    (tag) => !aplicadas.some((usada) => usada.id === tag.id),
  );

  return (
    <div className={compacto ? 'text-xs' : 'text-sm'}>
      <ul className="flex flex-wrap items-center gap-1.5">
        {aplicadas.map((tag) => (
          <li key={tag.id}>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
              style={
                tag.cor
                  ? { backgroundColor: `${tag.cor}22`, color: tag.cor }
                  : { backgroundColor: 'rgba(0,0,0,.06)' }
              }
            >
              {tag.nome}
              <button
                type="button"
                disabled={pendente}
                onClick={(evento) => {
                  evento.stopPropagation();
                  executar(() => removerTag({ lead_id: leadId, tag_id: tag.id }));
                }}
                aria-label={`Remover etiqueta ${tag.nome}`}
                className="opacity-60 transition hover:opacity-100 disabled:opacity-30"
              >
                ×
              </button>
            </span>
          </li>
        ))}

        {!abrindo && (
          <li>
            <button
              type="button"
              draggable={false}
              disabled={pendente}
              onClick={(evento) => {
                evento.stopPropagation();
                setAbrindo(true);
              }}
              className="rounded-full border border-dashed border-linha-forte px-2 py-0.5 text-xs text-texto-2 transition hover:bg-superficie-2 disabled:opacity-50"
            >
              + etiqueta
            </button>
          </li>
        )}
      </ul>

      {abrindo && (
        <div className="mt-2 flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {naoAplicadas.length > 0 && (
            <select
              defaultValue=""
              disabled={pendente}
              onChange={(evento) => {
                const id = evento.target.value;
                if (!id) return;
                executar(() => aplicarTag({ lead_id: leadId, tag_id: id }));
                setAbrindo(false);
              }}
              className="rounded-padrao border border-linha-forte bg-transparent px-2 py-1 text-xs"
              aria-label="Escolher etiqueta existente"
            >
              <option value="">Escolher existente…</option>
              {naoAplicadas.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.nome}
                </option>
              ))}
            </select>
          )}

          <input
            value={novo}
            onChange={(evento) => setNovo(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key !== 'Enter') return;
              evento.preventDefault();
              if (!novo.trim()) return;
              executar(async () => {
                const resultado = await aplicarTag({
                  lead_id: leadId,
                  nome: novo.trim(),
                  cor: COR_NOVA,
                });
                if (!resultado.erro) setNovo('');
                return resultado;
              });
              setAbrindo(false);
            }}
            placeholder="ou criar nova + Enter"
            maxLength={40}
            disabled={pendente}
            className="w-40 rounded-padrao border border-linha-forte bg-transparent px-2 py-1 text-xs"
            aria-label="Criar nova etiqueta"
          />

          <button
            type="button"
            onClick={() => {
              setAbrindo(false);
              setNovo('');
            }}
            className="text-xs text-texto-3 hover:underline"
          >
            cancelar
          </button>
        </div>
      )}

      {erro && <p className="mt-2 text-xs text-perigo">{erro}</p>}
    </div>
  );
}
