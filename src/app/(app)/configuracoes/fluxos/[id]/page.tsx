import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AVISO, LINK_DISCRETO, SELO_ACAO, SELO_NEUTRO, TEXTO_2, TITULO_TELA } from '@/components/ui';
import { ConstrutorDeFluxo } from '@/components/crm/ConstrutorDeFluxo';
import { SimuladorDeFluxo } from '@/components/crm/SimuladorDeFluxo';
import { listarLeads, organizacaoAtual } from '@/lib/crm/dados';
import { carregarFluxo, opcoesDoConstrutor } from '@/lib/crm/fluxos';

export const metadata: Metadata = { title: 'Fluxo · ByTech3' };

/**
 * O construtor de um fluxo.
 *
 * As quatro consultas vão juntas: nenhuma depende da outra, e todas dependem
 * só do `id` da URL e da organização. Em série seriam quatro esperas onde
 * cabe uma.
 */
export default async function PaginaFluxo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const organizacao = await organizacaoAtual();

  const [dados, opcoes, carteira] = await Promise.all([
    carregarFluxo(organizacao.organization_id, id),
    opcoesDoConstrutor(organizacao.organization_id),
    // Os leads do simulador. A RLS já entrega só a carteira de quem olha, e a
    // função `simular_fluxo` confere de novo do lado do banco.
    listarLeads(organizacao.organization_id, { incluirArquivados: false, filtros: {} }),
  ]);

  // `null` = não existe OU não é desta organização. A RLS não distingue os
  // dois, e a tela não deve inventar a diferença.
  if (!dados) notFound();

  const podeGerenciar = organizacao.papel === 'admin' || organizacao.papel === 'gestor';

  return (
    <div className="space-y-6">
      <header>
        <Link href="/configuracoes/fluxos" className={`text-sm ${LINK_DISCRETO}`}>
          ← Voltar para os fluxos
        </Link>

        <h1 className={`mt-2 flex flex-wrap items-center gap-3 ${TITULO_TELA}`}>
          {dados.fluxo.nome}
          {dados.fluxo.ativo ? (
            <span className={SELO_ACAO}>Ativo</span>
          ) : (
            <span className={SELO_NEUTRO}>Desativado</span>
          )}
        </h1>

        {dados.fluxo.descricao && <p className={`mt-1 ${TEXTO_2}`}>{dados.fluxo.descricao}</p>}
      </header>

      {dados.fluxo.ativo && (
        <p className={AVISO}>
          <span className="font-semibold">Este fluxo está ligado.</span> Cada alteração aqui vale
          para os próximos disparos — e eles acontecem com clientes de verdade. Para mexer com
          calma, desative antes, no fim da página.
        </p>
      )}

      {!podeGerenciar && (
        <p className={AVISO}>
          Você está vendo o fluxo em modo leitura. Montar automação é de gestores e administradores.
        </p>
      )}

      <SimuladorDeFluxo
        fluxoId={dados.fluxo.id}
        leads={carteira.leads.map((lead) => ({ id: lead.id, nome: lead.nome }))}
      />

      <ConstrutorDeFluxo
        dados={dados}
        opcoes={opcoes}
        podeGerenciar={podeGerenciar}
        acessoAtivo={organizacao.acesso_ativo}
      />
    </div>
  );
}
