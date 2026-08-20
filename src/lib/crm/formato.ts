/**
 * Formatação para exibição (pt-BR).
 *
 * O fuso é fixado em America/Sao_Paulo de propósito: estas funções rodam no
 * servidor, e sem fuso explícito a data renderizada dependeria da máquina que
 * fez o build — "01/02" no servidor e "31/01" na tela do cliente.
 */

const FUSO = 'America/Sao_Paulo';

const MOEDA = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const DATA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: FUSO,
});

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: FUSO,
});

export function formatarMoeda(valor: number | null): string {
  if (valor === null || Number.isNaN(valor)) return '—';
  return MOEDA.format(valor);
}

export function formatarDataHora(iso: string | null): string {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return DATA_HORA.format(data);
}

export function formatarData(iso: string | null): string {
  if (!iso) return '—';
  // Colunas `date` chegam como "2026-08-20" — sem hora e sem fuso. Tratar como
  // meia-noite UTC evita o clássico "voltou um dia" ao converter para -03:00.
  const data = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return DATA.format(data);
}

/** Texto vazio vira travessão, para a tabela não ficar com buracos. */
export function ouTraco(valor: string | null | undefined): string {
  const texto = (valor ?? '').trim();
  return texto.length > 0 ? texto : '—';
}

/**
 * Numeric do Postgres pode chegar como número ou como string, dependendo da
 * versão do PostgREST. Normaliza sem inventar zero onde o valor é nulo.
 */
export function paraNumero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  return Number.isFinite(numero) ? numero : null;
}
