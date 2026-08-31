/**
 * Linha do tempo do lead — leitura pura da tabela `activities`.
 *
 * Nada aqui é escrito pelo app: cada linha desta lista foi gravada por um
 * trigger do banco no momento em que o fato aconteceu (migration 0002, PASSO 8).
 * É por isso que o histórico registra até edições feitas fora desta tela.
 */
import { formatarData, formatarDataHora, formatarMoeda, paraNumero } from '@/lib/crm/formato';
import type { ItemHistorico, MembroOrg } from '@/lib/crm/tipos';

const ROTULO_EVENTO: Record<string, string> = {
  'lead.created': 'Lead criado',
  'lead.updated': 'Dados atualizados',
  'lead.assigned': 'Responsável alterado',
  'lead.archived': 'Lead arquivado',
  'lead.restored': 'Lead restaurado',
  'lead.stage_changed': 'Mudou de etapa',
  'lead.pipeline_added': 'Entrou no funil',
  'lead.pipeline_removed': 'Saiu do funil',
  'tag.added': 'Tag aplicada',
  'tag.removed': 'Tag removida',
  'note.created': 'Nota registrada',
  'task.created': 'Tarefa criada',
  'task.completed': 'Tarefa concluída',
  'task.overdue': 'Tarefa atrasada',
  'message.received': 'Mensagem recebida',
  'appointment.created': 'Agendamento criado',
};

const COR_EVENTO: Record<string, string> = {
  'lead.created': 'bg-acao',
  'lead.stage_changed': 'bg-sky-500',
  'lead.pipeline_added': 'bg-sky-500',
  'lead.pipeline_removed': 'bg-texto-3',
  'lead.archived': 'bg-alerta',
  'lead.restored': 'bg-acao',
  'lead.assigned': 'bg-violet-500',
};

const ROTULO_CAMPO: Record<string, string> = {
  nome: 'Nome',
  telefone: 'Telefone',
  email: 'E-mail',
  origem: 'Origem',
  valor: 'Valor',
  previsao_fechamento: 'Previsão de fechamento',
};

function textoValor(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (campo === 'valor') return formatarMoeda(paraNumero(valor));
  if (campo === 'previsao_fechamento') return formatarData(String(valor));
  return String(valor);
}

/** `dados` de um `lead.updated` vem como { campo: { de, para } }. */
function mudancas(dados: Record<string, unknown>) {
  return Object.entries(ROTULO_CAMPO)
    .map(([campo, rotulo]) => {
      const mudanca = dados[campo];
      if (!mudanca || typeof mudanca !== 'object') return null;
      const { de, para } = mudanca as { de?: unknown; para?: unknown };
      return { campo, rotulo, de: textoValor(campo, de), para: textoValor(campo, para) };
    })
    .filter((item): item is { campo: string; rotulo: string; de: string; para: string } =>
      Boolean(item),
    );
}

export function LinhaDoTempo({
  eventos,
  membros,
}: {
  eventos: ItemHistorico[];
  membros: MembroOrg[];
}) {
  if (eventos.length === 0) {
    return (
      <p className="text-sm text-texto-2">
        Nenhum evento registrado ainda.
      </p>
    );
  }

  const nomePorId = new Map(membros.map((membro) => [membro.user_id, membro.nome]));
  const nomeDe = (id: unknown) =>
    typeof id === 'string' ? nomePorId.get(id) ?? 'Usuário' : 'ninguém';

  return (
    <ol className="space-y-4">
      {eventos.map((evento) => {
        const alteracoes = evento.tipo === 'lead.updated' ? mudancas(evento.dados) : [];

        return (
          <li key={evento.id} className="flex gap-3">
            <span
              aria-hidden
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                COR_EVENTO[evento.tipo] ?? 'bg-texto-3'
              }`}
            />

            <div className="min-w-0 flex-1 border-b border-linha pb-4 last:border-0">
              <p className="text-sm">
                {evento.descricao ?? ROTULO_EVENTO[evento.tipo] ?? evento.tipo}
              </p>

              {evento.tipo === 'lead.assigned' && (
                <p className="mt-1 text-xs text-texto-2">
                  De {nomeDe(evento.dados.de)} para {nomeDe(evento.dados.para)}
                </p>
              )}

              {alteracoes.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-texto-2">
                  {alteracoes.map((alteracao) => (
                    <li key={alteracao.campo}>
                      <span className="font-medium">{alteracao.rotulo}:</span> {alteracao.de} →{' '}
                      {alteracao.para}
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-1 text-xs text-texto-3">
                {formatarDataHora(evento.criado_em)}
                {evento.autor ? ` · ${evento.autor}` : ' · sistema'}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
