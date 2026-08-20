/**
 * Tipos e constantes do CRM (Fase 3).
 *
 * As formas aqui espelham as tabelas da migration `0002_fase3_crm.sql`. Elas
 * NÃO são a fonte da verdade de segurança — quem decide o que o usuário lê e
 * escreve é a RLS no banco. Aqui é só o contrato de dados do frontend.
 */

/**
 * Origem do lead: lista fechada (CLAUDE.md §9), a mesma do
 * `check (origem in (...))` da tabela `leads`. Se divergir daqui, o banco
 * recusa a gravação — de propósito.
 */
export const ORIGENS_LEAD = [
  'Instagram',
  'Facebook',
  'Google',
  'Indicação',
  'Campanha específica',
  'Site',
  'WhatsApp direto',
  'Outro',
  'Não identificado',
] as const;

export type OrigemLead = (typeof ORIGENS_LEAD)[number];

/** Nunca forçar o vendedor a inventar origem. */
export const ORIGEM_PADRAO: OrigemLead = 'Não identificado';

export function ehOrigemValida(valor: string): valor is OrigemLead {
  return (ORIGENS_LEAD as readonly string[]).includes(valor);
}

export type TipoEtapa = 'aberta' | 'ganho' | 'perdido';

export type Lead = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  origem: string;
  valor: number | null;
  previsao_fechamento: string | null;
  ultimo_contato_em: string | null;
  responsavel_id: string | null;
  arquivado: boolean;
  criado_em: string;
  atualizado_em: string | null;
};

/** Em que etapa de qual funil o lead está (vem de `lead_pipeline`). */
export type EtapaAtual = {
  vinculo_id: string;
  pipeline_id: string;
  pipeline_nome: string;
  pipeline_padrao: boolean;
  stage_id: string;
  stage_nome: string;
  tipo: TipoEtapa;
  entrou_na_etapa_em: string;
};

/** Membro ativo da organização — vira opção de "responsável". */
export type MembroOrg = {
  user_id: string;
  nome: string;
  email: string | null;
  papel: 'admin' | 'gestor' | 'vendedor';
};

/** Lead já enriquecido com responsável e etapa, pronto para a tela. */
export type LeadDaTela = Lead & {
  responsavel: MembroOrg | null;
  etapa: EtapaAtual | null;
};

/** Uma linha da linha do tempo (tabela `activities`, gravada por trigger). */
export type ItemHistorico = {
  id: string;
  tipo: string;
  descricao: string | null;
  dados: Record<string, unknown>;
  criado_em: string;
  user_id: string | null;
  autor: string | null;
};

/** A primeira etapa do funil padrão — onde todo lead novo entra. */
export type FunilPadrao = {
  pipeline_id: string;
  pipeline_nome: string;
  primeira_etapa_id: string;
  primeira_etapa_nome: string;
};

/**
 * Estado dos formulários (React `useActionState`).
 *
 * `valores` devolve o que o usuário digitou para o formulário não esvaziar
 * quando o banco recusa a gravação; `tentativa` só existe para forçar a
 * remontagem dos campos com os valores devolvidos.
 */
export type ValoresFormLead = {
  nome: string;
  telefone: string;
  email: string;
  origem: string;
  responsavel_id: string;
  valor: string;
  previsao_fechamento: string;
};

export type EstadoFormLead = {
  erro: string | null;
  valores: ValoresFormLead | null;
  tentativa: number;
};

export const ESTADO_FORM_INICIAL: EstadoFormLead = {
  erro: null,
  valores: null,
  tentativa: 0,
};

/** Estado das ações de um clique só (arquivar, restaurar, entrar no funil). */
export type EstadoAcao = { erro: string | null };

export const ESTADO_ACAO_INICIAL: EstadoAcao = { erro: null };

// ---------------------------------------------------------------- KANBAN

/** Uma etiqueta aplicada a um lead. */
export type TagLead = {
  id: string;
  nome: string;
  cor: string | null;
};

/** Funil na lista do seletor. */
export type FunilResumo = {
  id: string;
  nome: string;
  descricao: string | null;
  padrao: boolean;
};

/** Um cartão do quadro — é uma linha de `lead_pipeline` com o lead resolvido. */
export type CartaoKanban = {
  vinculo_id: string;
  lead_id: string;
  nome: string;
  telefone: string | null;
  valor: number | null;
  responsavel: MembroOrg | null;
  tags: TagLead[];
  posicao: number;
  entrou_na_etapa_em: string;
};

/** Uma coluna do quadro = uma etapa do funil. */
export type ColunaKanban = {
  id: string;
  nome: string;
  tipo: TipoEtapa;
  cor: string | null;
  posicao: number;
  cartoes: CartaoKanban[];
};

export type Quadro = {
  funil: FunilResumo;
  colunas: ColunaKanban[];
  total_cartoes: number;
  atingiu_limite: boolean;
};

/**
 * Pedido de movimentação de cartão.
 *
 * O cliente manda a INTENÇÃO (para qual etapa, em que posição da coluna), não
 * o número da `posicao`. Quem calcula o número é o servidor, com os dados
 * frescos do banco — senão dois vendedores arrastando ao mesmo tempo
 * gravariam posições calculadas sobre uma tela velha.
 */
export type PedidoMover = {
  vinculo_id: string;
  stage_id: string;
  /** Índice dentro da coluna de destino, já sem o cartão que está sendo movido. */
  indice: number;
};
