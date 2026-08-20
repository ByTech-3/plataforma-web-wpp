/**
 * Tradução dos erros do banco para frases que o usuário entende.
 *
 * REGRA DA FASE 3: o bloqueio por licença/trial vencido é regra de BACKEND
 * (`org_acesso_ativo()` dentro das policies). O frontend não esconde o botão e
 * finge que o recurso não existe — ele deixa a tentativa acontecer e explica a
 * recusa que veio do banco. Esconder na UI não é bloqueio; a policy é.
 *
 * O mesmo vale para a regra de carteira: quem recusa é a RLS, não este arquivo.
 */
import type { PostgrestError } from '@supabase/supabase-js';

type Contexto = {
  /** `acesso_ativo` do `meu_contexto()`. Deixa a mensagem específica. */
  acessoAtivo?: boolean;
  /** Ação tentada, para a frase ficar natural: "criar o lead", "arquivar". */
  acao?: string;
};

export function traduzirErroBanco(erro: PostgrestError, contexto: Contexto = {}): string {
  const acao = contexto.acao ?? 'concluir a operação';
  const mensagem = erro.message ?? '';

  // 42501 / "row-level security" = a policy recusou. Duas causas possíveis:
  // licença vencida (org em somente leitura) ou o lead não é da sua carteira.
  if (erro.code === '42501' || /row-level security|violates row-level/i.test(mensagem)) {
    if (contexto.acessoAtivo === false) {
      return (
        `Não foi possível ${acao}: o período de teste desta organização terminou ` +
        'e o banco só aceita leitura enquanto a licença não for reativada.'
      );
    }
    return (
      `Não foi possível ${acao}. O banco recusou a gravação — isso acontece quando ` +
      'a licença da organização não está ativa ou quando o lead não pertence à sua ' +
      'carteira. Fale com o administrador da conta.'
    );
  }

  // P0001 = exception levantada pelos triggers (`tg_valida_lead`, guarda de
  // admin). As mensagens já vêm em português e são específicas: repasse.
  if (erro.code === 'P0001') return mensagem;

  // Violação de check: origem fora da lista fixa ou valor negativo.
  if (erro.code === '23514') {
    if (/origem/i.test(mensagem)) {
      return 'Origem inválida. Escolha uma das opções da lista.';
    }
    if (/valor/i.test(mensagem)) {
      return 'O valor do negócio não pode ser negativo.';
    }
    return `Dados inválidos para ${acao}.`;
  }

  if (erro.code === '23505') {
    return 'Já existe um registro com estes dados.';
  }

  // 23503 = FK. Na prática: responsável ou etapa que não pertence à organização.
  if (erro.code === '23503') {
    return 'Vínculo inválido: o registro apontado não pertence a esta organização.';
  }

  // PGRST116 = "0 linhas" num .single(). Do ponto de vista do usuário, o
  // registro não existe OU está fora da carteira dele — e a RLS não distingue
  // os dois de propósito (dizer "existe, mas não é seu" já é vazar informação).
  if (erro.code === 'PGRST116') {
    return 'Lead não encontrado ou fora da sua carteira.';
  }

  return `Não foi possível ${acao}: ${mensagem}`;
}
