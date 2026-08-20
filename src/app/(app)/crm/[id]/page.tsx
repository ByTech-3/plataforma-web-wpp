import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AVISO, CARTAO } from '@/components/ui';
import { AcaoLead } from '@/components/crm/AcaoLead';
import { LinhaDoTempo } from '@/components/crm/LinhaDoTempo';
import { alternarArquivamentoAction, entrarNoFunilPadraoAction } from '@/lib/crm/acoes';
import {
  carregarLead,
  listarHistorico,
  listarMembros,
  organizacaoAtual,
} from '@/lib/crm/dados';
import { formatarData, formatarDataHora, formatarMoeda, ouTraco } from '@/lib/crm/formato';

export const metadata: Metadata = { title: 'Lead · ByTech3' };

/**
 * Ficha do lead + linha do tempo.
 *
 * A linha do tempo é leitura pura de `activities`. Todo evento mostrado ali foi
 * gravado por trigger no banco — esta tela não escreve histórico, senão cada
 * ação apareceria duas vezes.
 */
export default async function PaginaLead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const organizacao = await organizacaoAtual();
  const lead = await carregarLead(organizacao.organization_id, id);

  // `null` aqui significa "não existe" OU "está fora da sua carteira". A RLS
  // não distingue os dois de propósito: responder "existe, mas não é seu" já
  // seria contar ao vendedor que o lead existe.
  if (!lead) notFound();

  const [historico, membros] = await Promise.all([
    listarHistorico(lead.id),
    listarMembros(organizacao.organization_id),
  ]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/crm"
            className="text-sm text-neutral-600 hover:underline dark:text-neutral-400"
          >
            ← Voltar para os leads
          </Link>

          <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {lead.nome}
            {lead.arquivado && (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                Arquivado
              </span>
            )}
          </h1>

          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {lead.etapa
              ? `${lead.etapa.pipeline_nome} · ${lead.etapa.stage_nome} (desde ${formatarDataHora(
                  lead.etapa.entrou_na_etapa_em,
                )})`
              : 'Este lead não está em nenhum funil.'}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <Link
            href={`/crm/${lead.id}/editar`}
            className="rounded-md border border-black/15 px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Editar
          </Link>

          <AcaoLead
            acao={alternarArquivamentoAction}
            campos={{ lead_id: lead.id, arquivar: lead.arquivado ? '0' : '1' }}
            rotulo={lead.arquivado ? 'Restaurar' : 'Arquivar'}
            rotuloEnviando={lead.arquivado ? 'Restaurando…' : 'Arquivando…'}
          />
        </div>
      </header>

      {!organizacao.acesso_ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Acesso somente leitura.</span> O período de teste terminou:
          o banco recusa alterações neste lead até a licença ser reativada.
        </p>
      )}

      {!lead.etapa && (
        <div className={AVISO}>
          <p>
            <span className="font-semibold">Fora do funil.</span> O lead existe e tem histórico, mas
            não aparece no Kanban enquanto não estiver em uma etapa.
          </p>
          <div className="mt-3">
            <AcaoLead
              acao={entrarNoFunilPadraoAction}
              campos={{ lead_id: lead.id }}
              rotulo="Colocar no funil padrão"
              rotuloEnviando="Colocando…"
              variante="destaque"
            />
          </div>
        </div>
      )}

      <section className={CARTAO}>
        <h2 className="text-sm font-semibold">Ficha</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Dado rotulo="Telefone">{ouTraco(lead.telefone)}</Dado>
          <Dado rotulo="E-mail">{ouTraco(lead.email)}</Dado>
          <Dado rotulo="Origem">{lead.origem}</Dado>
          <Dado rotulo="Responsável">{lead.responsavel?.nome ?? 'Sem responsável'}</Dado>
          <Dado rotulo="Valor do negócio">{formatarMoeda(lead.valor)}</Dado>
          <Dado rotulo="Previsão de fechamento">{formatarData(lead.previsao_fechamento)}</Dado>
          <Dado rotulo="Criado em">{formatarDataHora(lead.criado_em)}</Dado>
          <Dado rotulo="Última alteração">{formatarDataHora(lead.atualizado_em)}</Dado>
          <Dado rotulo="Último contato">{formatarDataHora(lead.ultimo_contato_em)}</Dado>
        </dl>
      </section>

      <section className={CARTAO}>
        <h2 className="text-sm font-semibold">Linha do tempo</h2>
        <p className="mt-1 mb-5 text-xs text-neutral-500">
          Registrada automaticamente pelo banco a cada evento. Não é editável — nem por
          administrador.
        </p>
        <LinhaDoTempo eventos={historico} membros={membros} />
      </section>
    </div>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-widest text-neutral-500">{rotulo}</dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}
