/**
 * Inbox: as conversas recentes capturadas pela extensão.
 *
 * PRIVACIDADE: a conversa é do VENDEDOR, não da organização. A policy
 * `conversa_select_propria` já garante isso — nem gestor nem admin veem as
 * conversas de outra pessoa. Este arquivo não precisa (e não deve) filtrar por
 * papel: a lista de conversas recentes de alguém inclui o fornecedor, o médico
 * e o grupo da família.
 *
 * DUPLICIDADE: a checagem de "já é lead" passa por `situacao_por_contato()`,
 * criada na migration 0003. Ela enxerga além da carteira e responde só uma
 * palavra por contato — é o que permite avisar "já é lead de outro vendedor"
 * sem revelar de quem nem os dados dele.
 */
import { criarClienteServidor } from '@/lib/supabase/server';
import type { CartaoConversa, SituacaoContato } from './tipos';

/** Teto da Inbox. A extensão captura até este tanto; a tela mostra o mesmo. */
export const LIMITE_INBOX = 50;

/**
 * Teto da busca de leads usada só para achar o ID de quem já é lead da própria
 * carteira (para o link "abrir ficha"). A resposta de duplicidade em si vem da
 * função do banco, não daqui.
 */
const LIMITE_LEADS_PARA_VINCULO = 500;

type LinhaConversa = {
  id: string;
  chat_id: string;
  origem_do_id: 'jid' | 'titulo';
  titulo: string | null;
  telefone: string | null;
  eh_grupo: boolean;
  posicao: number;
  lead_id: string | null;
};

function soDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

/** Mesma regra do banco (`mesmo_telefone`): pelo fim, até 11, mínimo 8. */
function mesmoTelefone(a: string | null, b: string | null): boolean {
  const da = soDigitos(a);
  const db = soDigitos(b);
  if (da.length < 8 || db.length < 8) return false;
  const comparar = Math.min(da.length, db.length, 11);
  return da.slice(-comparar) === db.slice(-comparar);
}

export async function listarInbox(organizationId: string): Promise<CartaoConversa[]> {
  const supabase = await criarClienteServidor();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('whatsapp_conversas')
    .select('id, chat_id, origem_do_id, titulo, telefone, eh_grupo, posicao, lead_id')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .order('posicao', { ascending: true })
    .limit(LIMITE_INBOX);

  if (error) {
    throw new Error(`Falha ao carregar a Inbox: ${error.message}`);
  }

  const conversas = (data ?? []) as LinhaConversa[];
  if (conversas.length === 0) return [];

  const telefones = [
    ...new Set(conversas.map((conversa) => conversa.telefone).filter((t): t is string => !!t)),
  ];

  // Uma chamada só para todos os telefones — a função aceita array justamente
  // para não virar N consultas com a Inbox aberta.
  const situacoes = new Map<string, SituacaoContato>();
  if (telefones.length > 0) {
    const { data: respostas, error: erroSituacao } = await supabase.rpc('situacao_por_contato', {
      p_org: organizationId,
      p_contatos: telefones,
    });

    if (erroSituacao) {
      throw new Error(`Falha ao checar duplicidade: ${erroSituacao.message}`);
    }

    for (const linha of (respostas ?? []) as { contato: string; situacao: SituacaoContato }[]) {
      situacoes.set(linha.contato, linha.situacao);
    }
  }

  // Só para achar o id do lead quando ele é da própria carteira, e assim
  // oferecer o link para a ficha. Quem é de outra carteira não entra aqui —
  // e é exatamente isso que a RLS garante.
  const { data: leadsVisiveis } = await supabase
    .from('leads')
    .select('id, nome, telefone')
    .eq('organization_id', organizationId)
    .eq('arquivado', false)
    .limit(LIMITE_LEADS_PARA_VINCULO);

  const visiveis = (leadsVisiveis ?? []) as {
    id: string;
    nome: string;
    telefone: string | null;
  }[];

  return conversas.map((conversa) => {
    const situacaoDoBanco = conversa.telefone
      ? situacoes.get(conversa.telefone) ?? 'nenhum'
      : 'nenhum';

    // O vínculo gravado vence a checagem por telefone: se esta conversa já
    // gerou um lead, é aquele lead, mesmo que o telefone tenha sido corrigido
    // na ficha depois.
    const leadVinculado = conversa.lead_id
      ? visiveis.find((lead) => lead.id === conversa.lead_id) ?? null
      : conversa.telefone
        ? visiveis.find((lead) => mesmoTelefone(lead.telefone, conversa.telefone)) ?? null
        : null;

    let situacao: CartaoConversa['situacao'];
    if (conversa.lead_id || leadVinculado || situacaoDoBanco === 'sua_carteira') {
      situacao = 'ja_e_lead';
    } else if (situacaoDoBanco === 'outra_carteira') {
      situacao = 'outra_carteira';
    } else {
      situacao = 'nova';
    }

    return {
      id: conversa.id,
      titulo: conversa.titulo?.trim() || 'Conversa sem nome',
      telefone: conversa.telefone,
      eh_grupo: conversa.eh_grupo,
      identificador_confiavel: conversa.origem_do_id === 'jid',
      situacao,
      lead_id: conversa.lead_id ?? leadVinculado?.id ?? null,
      lead_nome: leadVinculado?.nome ?? null,
    };
  });
}
