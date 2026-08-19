/**
 * Criação da organização do usuário (lado browser).
 *
 * Todo o trabalho pesado está no banco: `criar_organizacao()` cria, numa só
 * transação, a organização + o membership de admin + a assinatura em trial.
 * A duração do trial é constante do servidor — o cliente não escolhe, não
 * envia e não consegue esticar.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deduplicação entre montagens do React.
 *
 * Em desenvolvimento o StrictMode monta o componente duas vezes; sem isto,
 * duas chamadas simultâneas passariam pela verificação "já tem organização?"
 * ao mesmo tempo e o usuário terminaria com DUAS empresas criadas.
 * Guardar a promessa em escopo de módulo sobrevive à remontagem.
 */
let emAndamento: Promise<void> | null = null;

export async function garantirOrganizacao(
  supabase: SupabaseClient,
  nomeEmpresa: string,
): Promise<void> {
  if (emAndamento) return emAndamento;

  emAndamento = (async () => {
    // Já pertence a alguma organização? Então não há nada a fazer.
    const { data: contexto, error: erroContexto } = await supabase.rpc('meu_contexto');
    if (erroContexto) throw new Error(erroContexto.message);
    if (Array.isArray(contexto) && contexto.length > 0) return;

    const { error } = await supabase.rpc('criar_organizacao', {
      p_nome: nomeEmpresa,
    });
    if (error) throw new Error(error.message);
  })();

  try {
    await emAndamento;
  } finally {
    emAndamento = null;
  }
}
