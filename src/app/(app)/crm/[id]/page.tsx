import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AVISO, CARTAO } from '@/components/ui';
import { AcaoLead } from '@/components/crm/AcaoLead';
import { EnviarMensagem } from '@/components/crm/EnviarMensagem';
import { LinhaDoTempo } from '@/components/crm/LinhaDoTempo';
import { TagsDoLead } from '@/components/crm/TagsDoLead';
import { alternarArquivamentoAction, entrarNoFunilPadraoAction } from '@/lib/crm/acoes';
import {
  carregarLead,
  listarHistorico,
  listarMembros,
  organizacaoAtual,
} from '@/lib/crm/dados';
import { listarTags, tagsDoLead } from '@/lib/crm/tags';
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

  // Tudo numa ida só. O histórico e as tags são do lead, mas dependem do `id`
  // da URL — não do lead já carregado. Esperar o lead para só então pedir o
  // resto somava uma ida ao banco que não precisava existir.
  //
  // Se o id for inválido, essas consultas voltam vazias e a RLS não deixa
  // vazar nada: o custo do palpite é uma consulta sem resultado, no caminho
  // raro; o ganho é uma ida a menos no caminho normal.
  const [lead, historico, membros, tagsAplicadas, tagsDaOrganizacao] = await Promise.all([
    carregarLead(organizacao.organization_id, id),
    listarHistorico(id),
    listarMembros(organizacao.organization_id),
    tagsDoLead(id),
    listarTags(organizacao.organization_id),
  ]);

  // `null` aqui significa "não existe" OU "está fora da sua carteira". A RLS
  // não distingue os dois de propósito: responder "existe, mas não é seu" já
  // seria contar ao vendedor que o lead existe.
  if (!lead) notFound();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/crm"
            className="text-sm text-texto-2 hover:underline"
          >
            ← Voltar para os leads
          </Link>

          <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {lead.nome}
            {lead.arquivado && (
              <span className="rounded-full bg-alerta-suave px-2.5 py-1 text-xs font-medium text-alerta">
                Arquivado
              </span>
            )}
          </h1>

          <p className="mt-1 text-sm text-texto-2">
            {lead.etapa
              ? `${lead.etapa.pipeline_nome} · ${lead.etapa.stage_nome} (desde ${formatarDataHora(
                  lead.etapa.entrou_na_etapa_em,
                )})`
              : 'Este lead não está em nenhum funil.'}
          </p>
        </div>

        <div className="flex flex-wrap items-start gap-2">
          <EnviarMensagem leadId={lead.id} nome={lead.nome} />

          <Link
            href={`/crm/${lead.id}/editar`}
            className="rounded-padrao border border-linha-forte px-4 py-2 text-sm font-medium transition hover:bg-superficie-2"
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
        <h2 className="text-sm font-semibold">Etiquetas</h2>
        <p className="mt-1 mb-3 text-xs text-texto-3">
          Cada etiqueta aplicada ou removida entra na linha do tempo, gravada pelo banco.
        </p>
        <TagsDoLead leadId={lead.id} aplicadas={tagsAplicadas} disponiveis={tagsDaOrganizacao} />
      </section>

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
        <p className="mt-1 mb-5 text-xs text-texto-3">
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
      <dt className="text-xs font-medium uppercase tracking-widest text-texto-3">{rotulo}</dt>
      <dd className="mt-1 text-sm wrap-break-word">{children}</dd>
    </div>
  );
}
