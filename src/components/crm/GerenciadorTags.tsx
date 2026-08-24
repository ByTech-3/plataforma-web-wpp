'use client';

/**
 * Gestão das etiquetas da organização.
 *
 * Criar é de qualquer membro com licença; renomear e excluir é de
 * gestor/admin, porque uma etiqueta aparece nos leads de todo mundo. Os
 * controles seguem essa divisão, e a RLS recusa mesmo se alguém chamar a
 * Server Action por fora.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CAMPO, CARTAO, ERRO, ROTULO } from '@/components/ui';
import { criarTag, excluirTag, salvarTag } from '@/lib/crm/acoes-tags';
import { COR_PADRAO_TIPO, type EstadoAcao } from '@/lib/crm/tipos';
import type { TagGerenciavel } from '@/lib/crm/tags';

const BOTAO_MENOR =
  'rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium transition ' +
  'hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10';

export function GerenciadorTags({
  tags,
  podeGerenciar,
}: {
  tags: TagGerenciavel[];
  podeGerenciar: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function executar(acao: () => Promise<EstadoAcao>) {
    setErro(null);
    iniciar(async () => {
      const resultado = await acao();
      if (resultado.erro) setErro(resultado.erro);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {erro && <p className={ERRO}>{erro}</p>}

      <FormNovaTag executar={executar} pendente={pendente} />

      <section className={CARTAO}>
        <h2 className="text-sm font-semibold">Etiquetas da organização</h2>
        <p className="mt-1 mb-4 text-xs text-neutral-500">
          Maiúsculas não contam: &quot;VIP&quot; e &quot;vip&quot; seriam a mesma etiqueta, e o
          banco recusa a segunda.
        </p>

        {tags.length === 0 ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Nenhuma etiqueta ainda. Crie acima, ou direto na ficha de um lead.
          </p>
        ) : (
          <ul className="space-y-3">
            {tags.map((tag) => (
              <LinhaTag
                key={tag.id}
                tag={tag}
                podeGerenciar={podeGerenciar}
                pendente={pendente}
                executar={executar}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FormNovaTag({
  executar,
  pendente,
}: {
  executar: (acao: () => Promise<EstadoAcao>) => void;
  pendente: boolean;
}) {
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(COR_PADRAO_TIPO.aberta);

  return (
    <form
      className={CARTAO}
      onSubmit={(evento) => {
        evento.preventDefault();
        if (!nome.trim()) return;
        executar(async () => {
          const resultado = await criarTag({ nome, cor });
          if (!resultado.erro) setNome('');
          return resultado;
        });
      }}
    >
      <h2 className="text-sm font-semibold">Nova etiqueta</h2>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label className={ROTULO} htmlFor="nova-tag">
            Nome
          </label>
          <input
            id="nova-tag"
            className={CAMPO}
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            maxLength={40}
            required
            placeholder="VIP, Aluno antigo, Reativação…"
            disabled={pendente}
          />
        </div>

        <div>
          <label className={ROTULO} htmlFor="nova-tag-cor">
            Cor
          </label>
          <input
            id="nova-tag-cor"
            type="color"
            value={cor}
            onChange={(evento) => setCor(evento.target.value)}
            disabled={pendente}
            className="h-9 w-14 cursor-pointer rounded-md border border-black/15 bg-transparent dark:border-white/20"
          />
        </div>

        <button
          type="submit"
          disabled={pendente || !nome.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
        >
          Criar
        </button>
      </div>
    </form>
  );
}

function LinhaTag({
  tag,
  podeGerenciar,
  pendente,
  executar,
}: {
  tag: TagGerenciavel;
  podeGerenciar: boolean;
  pendente: boolean;
  executar: (acao: () => Promise<EstadoAcao>) => void;
}) {
  const [nome, setNome] = useState(tag.nome);
  const [cor, setCor] = useState(tag.cor ?? COR_PADRAO_TIPO.aberta);

  const mudou = nome !== tag.nome || cor !== (tag.cor ?? COR_PADRAO_TIPO.aberta);

  function confirmarExclusao() {
    const aviso =
      tag.total_leads > 0
        ? `A etiqueta "${tag.nome}" está em ${tag.total_leads} lead(s). Eles NÃO serão apagados — ` +
          'só perdem a etiqueta, e cada remoção fica registrada no histórico. Continuar?'
        : `Excluir a etiqueta "${tag.nome}"?`;

    if (!window.confirm(aviso)) return;
    executar(() => excluirTag({ id: tag.id }));
  }

  return (
    <li className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-3 dark:border-white/15">
      <span
        aria-hidden
        className="mb-2 h-4 w-4 shrink-0 rounded-full border border-black/10"
        style={{ background: tag.cor ?? COR_PADRAO_TIPO.aberta }}
      />

      <div className="min-w-40 flex-1">
        <label className="mb-1 block text-xs font-medium" htmlFor={`tag-${tag.id}`}>
          Nome
        </label>
        <input
          id={`tag-${tag.id}`}
          className={CAMPO}
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
          maxLength={40}
          disabled={!podeGerenciar || pendente}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor={`tag-cor-${tag.id}`}>
          Cor
        </label>
        <input
          id={`tag-cor-${tag.id}`}
          type="color"
          value={cor}
          onChange={(evento) => setCor(evento.target.value)}
          disabled={!podeGerenciar || pendente}
          className="h-9 w-14 cursor-pointer rounded-md border border-black/15 bg-transparent dark:border-white/20"
        />
      </div>

      <span className="mb-2 text-xs text-neutral-500">
        {tag.total_leads} {tag.total_leads === 1 ? 'lead' : 'leads'}
      </span>

      {podeGerenciar && (
        <div className="mb-1 flex gap-2">
          <button
            type="button"
            className={BOTAO_MENOR}
            disabled={pendente || !mudou}
            onClick={() => executar(() => salvarTag({ id: tag.id, nome, cor }))}
          >
            Salvar
          </button>
          <button
            type="button"
            className={`${BOTAO_MENOR} text-red-700 dark:text-red-400`}
            disabled={pendente}
            onClick={confirmarExclusao}
          >
            Excluir
          </button>
        </div>
      )}
    </li>
  );
}
