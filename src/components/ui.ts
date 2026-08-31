/**
 * Vocabulário visual compartilhado.
 *
 * Estas constantes são a razão de o redesenho não ter exigido tocar em toda
 * tela: quase tudo já as usava. Trocar o valor aqui propaga.
 *
 * REGRA DO VERDE: `BOTAO_PRIMARIO` marca A ação principal da tela — uma por
 * tela. Se duas competem, uma delas é secundária.
 *
 * ESCALA DE TEXTO (cinco tamanhos, e só cinco):
 *   TITULO_TELA   página
 *   TITULO_SECAO  cartão / seção
 *   TEXTO         corpo
 *   TEXTO_2       apoio
 *   ROTULO_MINI   etiqueta de campo, cabeçalho de tabela
 */

// ------------------------------------------------------------- TIPOGRAFIA

export const TITULO_TELA = 'text-2xl font-semibold tracking-tight text-texto';
export const TITULO_SECAO = 'text-sm font-semibold text-texto';
export const TEXTO = 'text-sm text-texto';
export const TEXTO_2 = 'text-sm text-texto-2';
export const TEXTO_3 = 'text-xs text-texto-3';
export const ROTULO_MINI = 'text-[11px] font-medium uppercase tracking-wider text-texto-3';

// ---------------------------------------------------------------- SUPERFÍCIE

/** Cartão: superfície + sombra, sem borda. A borda era o que poluía. */
export const CARTAO = 'rounded-grande bg-superficie p-6 shadow-carta';

/** Variante encaixada (dentro de outro cartão), aí sim com linha discreta. */
export const CARTAO_INTERNO = 'rounded-padrao border border-linha p-4';

// ------------------------------------------------------------------ BOTÕES

const BOTAO_BASE =
  'inline-flex items-center justify-center gap-2 rounded-padrao font-medium ' +
  'transition disabled:cursor-not-allowed disabled:opacity-50';

/** A ação principal. Uma por tela. */
export const BOTAO_PRIMARIO =
  `${BOTAO_BASE} bg-acao px-4 py-2.5 text-sm text-white hover:bg-acao-forte`;

export const BOTAO_SECUNDARIO =
  `${BOTAO_BASE} border border-linha-forte bg-superficie px-4 py-2.5 text-sm ` +
  'text-texto hover:bg-superficie-2';

export const BOTAO_DISCRETO =
  `${BOTAO_BASE} px-3 py-1.5 text-xs text-texto-2 hover:bg-superficie-2`;

export const BOTAO_MENOR =
  `${BOTAO_BASE} border border-linha-forte px-3 py-1.5 text-xs text-texto hover:bg-superficie-2`;

export const BOTAO_PERIGO =
  `${BOTAO_BASE} border border-linha-forte px-3 py-1.5 text-xs text-perigo hover:bg-perigo-suave`;

// ------------------------------------------------------------------ CAMPOS

export const CAMPO =
  'w-full rounded-padrao border border-linha-forte bg-superficie px-3 py-2 text-sm text-texto ' +
  'outline-none transition placeholder:text-texto-3 ' +
  'focus:border-acao focus:ring-2 focus:ring-acao/20 disabled:opacity-60';

export const CAMPO_MENOR = `${CAMPO} py-1.5`;

export const ROTULO = 'mb-1.5 block text-sm font-medium text-texto';

// -------------------------------------------------------------------- AVISOS

export const ERRO =
  'rounded-padrao border border-perigo-linha bg-perigo-suave px-3.5 py-2.5 text-sm text-perigo';

export const AVISO =
  'rounded-padrao border border-alerta-linha bg-alerta-suave px-3.5 py-2.5 text-sm text-alerta';

export const SUCESSO =
  'rounded-padrao border border-acao/30 bg-acao-suave px-3.5 py-2.5 text-sm text-acao-texto';

export const INFO = 'rounded-padrao bg-superficie-2 px-3.5 py-2.5 text-sm text-texto-2';

// -------------------------------------------------------------------- SELOS

const SELO_BASE = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';

export const SELO_NEUTRO = `${SELO_BASE} bg-superficie-2 text-texto-2`;
export const SELO_ACAO = `${SELO_BASE} bg-acao-suave text-acao-texto`;
export const SELO_ALERTA = `${SELO_BASE} bg-alerta-suave text-alerta`;
export const SELO_PERIGO = `${SELO_BASE} bg-perigo-suave text-perigo`;

// ------------------------------------------------------------------ TABELA

export const TABELA_CAIXA = 'overflow-x-auto rounded-grande bg-superficie shadow-carta';
export const TABELA = 'w-full text-left text-sm';
export const TABELA_CABECALHO = `border-b border-linha ${ROTULO_MINI}`;
export const TABELA_TH = 'px-4 py-3 font-medium';
export const TABELA_LINHA = 'border-b border-linha last:border-0 transition hover:bg-superficie-2';
export const TABELA_TD = 'px-4 py-3';

// --------------------------------------------------------------------- LINKS

export const LINK = 'font-medium text-acao hover:underline';
export const LINK_DISCRETO = 'text-texto-2 hover:text-texto hover:underline';
