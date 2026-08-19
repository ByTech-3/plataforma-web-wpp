/**
 * Contexto do usuário logado: organização, papel e situação do trial.
 *
 * Vem da função `meu_contexto()` criada na Fase 2. Ela é SECURITY DEFINER mas
 * filtra por `auth.uid()` — devolve apenas as organizações em que o usuário
 * logado tem membership ativo. Um usuário jamais recebe dados de outra empresa
 * por aqui.
 */
import { cache } from 'react';
import { criarClienteServidor } from '@/lib/supabase/server';

export type PapelMembro = 'admin' | 'gestor' | 'vendedor';

export type StatusAssinatura =
  | 'trial'
  | 'ativa'
  | 'inadimplente'
  | 'cancelada'
  | 'expirada';

export type ContextoOrganizacao = {
  organization_id: string;
  organizacao_nome: string;
  organizacao_slug: string | null;
  papel: PapelMembro;
  plano: string | null;
  status: StatusAssinatura | null;
  trial_inicio: string | null;
  trial_fim: string | null;
  dias_restantes: number | null;
  acesso_ativo: boolean;
};

/**
 * `cache()` memoriza o resultado dentro de UMA renderização: o layout e a
 * página podem chamar à vontade que o banco é consultado uma vez só.
 */
export const carregarContexto = cache(async (): Promise<ContextoOrganizacao[]> => {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('meu_contexto');

  if (error) {
    throw new Error(`Falha ao carregar o contexto do usuário: ${error.message}`);
  }

  return (data ?? []) as ContextoOrganizacao[];
});

/** Rótulo legível do papel, para a interface. */
export const ROTULO_PAPEL: Record<PapelMembro, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  vendedor: 'Vendedor',
};

/** Rótulo legível do status da assinatura. */
export const ROTULO_STATUS: Record<StatusAssinatura, string> = {
  trial: 'Período de teste',
  ativa: 'Assinatura ativa',
  inadimplente: 'Pagamento pendente',
  cancelada: 'Cancelada',
  expirada: 'Expirada',
};
