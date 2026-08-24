'use server';

/**
 * Gestão de etiquetas e aplicação nos leads.
 *
 * NÃO insere em `activities`: `tag.added` e `tag.removed` já são gravados
 * pelos triggers da migration 0002. Registrar de novo duplicaria o histórico.
 *
 * Quem autoriza é a RLS: criar etiqueta é de qualquer membro com licença ativa;
 * renomear e excluir é de gestor/admin, porque afeta os leads de todo mundo;
 * aplicar e remover segue a carteira do lead.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { organizacaoAtual } from './dados';
import { traduzirErroBanco } from './erros';
import type { EstadoAcao } from './tipos';

const COR_VALIDA = /^#[0-9a-fA-F]{6}$/;

async function comContexto() {
  const supabase = await criarClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const organizacao = await organizacaoAtual();
  return { supabase, organizacao, user };
}

function atualizarTelas(leadId?: string) {
  revalidatePath('/crm');
  revalidatePath('/kanban');
  revalidatePath('/configuracoes/tags');
  if (leadId) revalidatePath(`/crm/${leadId}`);
}

function validar(nome: string, cor: string): string | null {
  const limpo = nome.trim();
  if (limpo.length < 1) return 'Informe o nome da etiqueta.';
  if (limpo.length > 40) return 'O nome da etiqueta passa de 40 caracteres.';
  if (cor && !COR_VALIDA.test(cor)) return 'Cor inválida.';
  return null;
}

export async function criarTag(entrada: { nome: string; cor: string }): Promise<EstadoAcao> {
  const invalido = validar(entrada.nome, entrada.cor);
  if (invalido) return { erro: invalido };

  const { supabase, organizacao, user } = await comContexto();

  const { error } = await supabase.from('tags').insert({
    organization_id: organizacao.organization_id,
    nome: entrada.nome.trim(),
    cor: entrada.cor || null,
    criado_por: user.id,
  });

  if (error) {
    // O índice único ignora maiúsculas de propósito: evita "VIP" e "vip"
    // convivendo como se fossem etiquetas diferentes.
    if (error.code === '23505') {
      return { erro: 'Já existe uma etiqueta com esse nome (maiúsculas não contam).' };
    }
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'criar a etiqueta',
      }),
    };
  }

  atualizarTelas();
  return { erro: null };
}

export async function salvarTag(entrada: {
  id: string;
  nome: string;
  cor: string;
}): Promise<EstadoAcao> {
  const invalido = validar(entrada.nome, entrada.cor);
  if (invalido) return { erro: invalido };

  const { supabase, organizacao } = await comContexto();

  const { data, error } = await supabase
    .from('tags')
    .update({ nome: entrada.nome.trim(), cor: entrada.cor || null })
    .eq('id', entrada.id)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) {
    if (error.code === '23505') {
      return { erro: 'Já existe uma etiqueta com esse nome.' };
    }
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'salvar a etiqueta',
      }),
    };
  }
  if ((data ?? []).length === 0) {
    return {
      erro: organizacao.acesso_ativo
        ? 'Nada foi salvo: renomear etiqueta é de gestor ou administrador.'
        : 'Nada foi salvo: o período de teste terminou.',
    };
  }

  atualizarTelas();
  return { erro: null };
}

/**
 * Exclui a etiqueta.
 *
 * Os leads que a tinham NÃO são apagados: o `on delete cascade` de `lead_tags`
 * remove só o vínculo, e o trigger registra um `tag.removed` para cada lead —
 * então nada some sem rastro no histórico. A tela avisa quantos serão afetados.
 */
export async function excluirTag(entrada: { id: string }): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const { data, error } = await supabase
    .from('tags')
    .delete()
    .eq('id', entrada.id)
    .eq('organization_id', organizacao.organization_id)
    .select('id');

  if (error) {
    return { erro: traduzirErroBanco(error, { acao: 'excluir a etiqueta' }) };
  }
  if ((data ?? []).length === 0) {
    return { erro: 'Nada foi excluído: apagar etiqueta é de gestor ou administrador.' };
  }

  atualizarTelas();
  return { erro: null };
}

/**
 * Aplica uma etiqueta ao lead.
 *
 * `tagId` vazio com `nome` preenchido cria a etiqueta na hora — é o caminho de
 * quem está com o lead aberto e não quer sair da tela para cadastrar antes.
 */
export async function aplicarTag(entrada: {
  lead_id: string;
  tag_id?: string;
  nome?: string;
  cor?: string;
}): Promise<EstadoAcao & { tag_id?: string }> {
  const { supabase, organizacao, user } = await comContexto();

  let tagId = entrada.tag_id ?? '';

  if (!tagId) {
    const nome = (entrada.nome ?? '').trim();
    const invalido = validar(nome, entrada.cor ?? '');
    if (invalido) return { erro: invalido };

    const { data: criada, error: erroCriar } = await supabase
      .from('tags')
      .insert({
        organization_id: organizacao.organization_id,
        nome,
        cor: entrada.cor || null,
        criado_por: user.id,
      })
      .select('id')
      .single();

    if (erroCriar) {
      // Já existe: aproveita a que está lá em vez de recusar. Quem digitou
      // "VIP" numa ficha quer a etiqueta VIP, não um erro.
      if (erroCriar.code === '23505') {
        const { data: existente } = await supabase
          .from('tags')
          .select('id')
          .eq('organization_id', organizacao.organization_id)
          .ilike('nome', nome)
          .maybeSingle();

        tagId = (existente as { id: string } | null)?.id ?? '';
      }

      if (!tagId) {
        return {
          erro: traduzirErroBanco(erroCriar, {
            acessoAtivo: organizacao.acesso_ativo,
            acao: 'criar a etiqueta',
          }),
        };
      }
    } else {
      tagId = (criada as { id: string }).id;
    }
  }

  const { error } = await supabase.from('lead_tags').insert({
    organization_id: organizacao.organization_id,
    lead_id: entrada.lead_id,
    tag_id: tagId,
    criado_por: user.id,
  });

  // Já estava aplicada: para o usuário, o resultado é o que ele queria.
  if (error && error.code !== '23505') {
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'aplicar a etiqueta',
      }),
    };
  }

  atualizarTelas(entrada.lead_id);
  return { erro: null, tag_id: tagId };
}

export async function removerTag(entrada: {
  lead_id: string;
  tag_id: string;
}): Promise<EstadoAcao> {
  const { supabase, organizacao } = await comContexto();

  const { data, error } = await supabase
    .from('lead_tags')
    .delete()
    .eq('lead_id', entrada.lead_id)
    .eq('tag_id', entrada.tag_id)
    .select('tag_id');

  if (error) {
    return {
      erro: traduzirErroBanco(error, {
        acessoAtivo: organizacao.acesso_ativo,
        acao: 'remover a etiqueta',
      }),
    };
  }
  if ((data ?? []).length === 0) {
    return {
      erro: organizacao.acesso_ativo
        ? 'Nada foi removido: este lead não está na sua carteira.'
        : 'Nada foi removido: o período de teste terminou.',
    };
  }

  atualizarTelas(entrada.lead_id);
  return { erro: null };
}
