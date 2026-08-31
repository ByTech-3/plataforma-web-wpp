/**
 * Tipos e vocabulário dos fluxos — SEM NENHUM ACESSO AO BANCO.
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO DE `fluxos.ts`:
 *   As telas do construtor são componentes de cliente e precisam dos rótulos
 *   ("Lead muda de etapa") e dos tipos. Importá-los de `fluxos.ts` arrastava o
 *   `criarClienteServidor` junto para o bundle do navegador — o build recusa,
 *   e com razão: código de servidor não tem o que fazer no cliente.
 *
 *   Aqui não há import de servidor nenhum, e é por isso que os dois lados
 *   podem usar este arquivo. `fluxos.ts` reexporta tudo, então quem já
 *   importava de lá continua funcionando.
 */


// ------------------------------------------------------------------- TIPOS

export type WebhookResumo = {
  id: string;
  nome: string;
  url: string;
  ativo: boolean;
  max_tentativas: number;
  timeout_ms: number;
  /** Contadores da fila, para a tela mostrar o que está travado. */
  na_fila: number;
  desistiu: number;
};

export type EventoGatilho =
  | 'lead.created'
  | 'lead.assigned'
  | 'lead.stage_changed'
  | 'lead.pipeline_added'
  | 'lead.archived'
  | 'lead.restored'
  | 'tag.added'
  | 'tag.removed'
  | 'message.received';

export type TipoAcao = 'mensagem' | 'webhook' | 'etiqueta' | 'mover_etapa';

export type GatilhoFluxo = {
  id: string;
  evento: EventoGatilho;
  pipeline_id: string | null;
  stage_id: string | null;
  tag_id: string | null;
  origem: string | null;
};

export type AcaoFluxo = {
  id: string;
  ordem: number;
  tipo: TipoAcao;
  config: Record<string, unknown>;
  atraso_minutos: number;
};

export type FluxoResumo = {
  id: string;
  nome: string;
  descricao: string | null;
  ativo: boolean;
  repetir: boolean;
  total_gatilhos: number;
  total_acoes: number;
  /** Quantas ações rodaram nos últimos 7 dias. Dá a noção de movimento. */
  execucoes_recentes: number;
};

export type FluxoCompleto = {
  fluxo: FluxoResumo;
  gatilhos: GatilhoFluxo[];
  acoes: AcaoFluxo[];
};

export type SituacaoEntrega = 'pendente' | 'enviando' | 'entregue' | 'falhou' | 'desistiu';

export type EntregaResumo = {
  id: string;
  evento: string;
  situacao: SituacaoEntrega;
  tentativas: number;
  proxima_em: string;
  ultimo_status: number | null;
  ultimo_erro: string | null;
  criado_em: string;
  entregue_em: string | null;
  webhook_nome: string | null;
  lead_id: string | null;
  lead_nome: string | null;
};

export type PassoSimulado = {
  ordem: number;
  tipo: TipoAcao;
  quando: string;
  resumo: string | null;
  texto: string | null;
  destino: string | null;
};

/** Opções dos seletores do construtor, numa consulta só. */
export type OpcoesDoConstrutor = {
  webhooks: { id: string; nome: string; ativo: boolean }[];
  tags: { id: string; nome: string }[];
  funis: { id: string; nome: string }[];
  etapas: { id: string; nome: string; pipeline_id: string }[];
};

// -------------------------------------------------------------- VOCABULÁRIO

/**
 * Como cada evento aparece na tela.
 *
 * Os nomes técnicos (`lead.stage_changed`) são os mesmos do histórico e do
 * n8n de propósito — mas quem monta um fluxo não deveria precisar aprendê-los.
 */
export const ROTULO_EVENTO: Record<EventoGatilho, string> = {
  'lead.created': 'Lead é criado',
  'lead.assigned': 'Lead ganha responsável',
  'lead.stage_changed': 'Lead muda de etapa',
  'lead.pipeline_added': 'Lead entra num funil',
  'lead.archived': 'Lead é arquivado',
  'lead.restored': 'Lead é restaurado',
  'tag.added': 'Etiqueta é aplicada',
  'tag.removed': 'Etiqueta é removida',
  'message.received': 'Mensagem é recebida',
};

export const EVENTOS: EventoGatilho[] = Object.keys(ROTULO_EVENTO) as EventoGatilho[];

export const ROTULO_ACAO: Record<TipoAcao, string> = {
  mensagem: 'Enviar mensagem (por webhook)',
  webhook: 'Chamar webhook',
  etiqueta: 'Aplicar etiqueta',
  mover_etapa: 'Mover para etapa',
};

/** As variáveis que o banco troca em `montar_texto_do_modelo`. */
export const VARIAVEIS_DO_MODELO = [
  '{{nome}}',
  '{{primeiro_nome}}',
  '{{telefone}}',
  '{{email}}',
  '{{origem}}',
  '{{etapa}}',
  '{{responsavel}}',
] as const;
