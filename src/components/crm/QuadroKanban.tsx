'use client';

/**
 * Quadro Kanban com arrastar e soltar nativo (HTML5 Drag and Drop).
 *
 * Sem biblioteca: o quadro é usado no desktop, e a API nativa dá conta de
 * arrastar cartão entre colunas. Como arrastar não funciona no toque, cada
 * cartão também tem um seletor "mover para" — que aparece nas telas estreitas
 * e serve de caminho pelo teclado, que o arrastar não oferece.
 *
 * A PRIMEIRA COLUNA é a Inbox: conversas recentes do WhatsApp que ainda NÃO
 * são leads. Ela é só origem de arrasto, nunca destino — um lead não "volta"
 * para conversa. Arrastar de lá para uma etapa é o que cria o lead.
 *
 * O cliente decide POSIÇÃO VISUAL (qual coluna, entre quais cartões) e manda a
 * intenção. Quem calcula o número gravado em `lead_pipeline.posicao` é o
 * servidor, com os dados frescos do banco.
 *
 * A movimentação é otimista: o cartão anda na hora e volta sozinho se o banco
 * recusar (licença vencida, lead fora da carteira), com o motivo na tela. Nada
 * é escondido preventivamente — quem recusa é a policy.
 */
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { CAMPO, ERRO, ROTULO } from '@/components/ui';
import { EnviarMensagem } from '@/components/crm/EnviarMensagem';
import { TagsDoLead } from '@/components/crm/TagsDoLead';
import { formatarMoeda, formatarTelefone } from '@/lib/crm/formato';
import {
  COR_PADRAO_TIPO,
  type CartaoConversa,
  type CartaoKanban,
  type ColunaKanban,
  type EstadoAcao,
  type PedidoCriarDaConversa,
  type PedidoMover,
  type TagLead,
} from '@/lib/crm/tipos';

type Props = {
  colunasIniciais: ColunaKanban[];
  inboxInicial: CartaoConversa[];
  mover: (pedido: PedidoMover) => Promise<EstadoAcao>;
  criarDaConversa: (
    pedido: PedidoCriarDaConversa,
  ) => Promise<EstadoAcao & { lead_id?: string }>;
  tagsDisponiveis: TagLead[];
};

type Arrasto =
  | { tipo: 'lead'; vinculoId: string; colunaId: string; indice: number }
  | { tipo: 'conversa'; conversa: CartaoConversa };

type Alvo = { colunaId: string; indice: number };

/** Cartão temporário enquanto o servidor não devolve o lead criado. */
type Provisorio = { id: string; colunaId: string; nome: string };

/** Conversa esperando o vendedor confirmar o telefone antes de virar lead. */
type Confirmacao = { conversa: CartaoConversa; stageId: string; indice: number };

const BOTAO_MENOR =
  'rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium transition ' +
  'hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10';

/** Cor escolhida na gestão do funil; na falta dela, a cor do tipo. */
function corDaEtapa(coluna: ColunaKanban): string {
  return coluna.cor ?? COR_PADRAO_TIPO[coluna.tipo];
}

/** Em que posição da lista o cursor está, comparando com o meio de cada cartão. */
function calcularIndice(lista: HTMLElement | null, clientY: number): number {
  if (!lista) return 0;
  const cartoes = Array.from(lista.querySelectorAll<HTMLElement>('[data-cartao]'));
  for (let i = 0; i < cartoes.length; i += 1) {
    const area = cartoes[i].getBoundingClientRect();
    if (clientY < area.top + area.height / 2) return i;
  }
  return cartoes.length;
}

export function QuadroKanban({
  colunasIniciais,
  inboxInicial,
  mover,
  criarDaConversa,
  tagsDisponiveis,
}: Props) {
  const [colunas, setColunas] = useState(colunasIniciais);
  const [inbox, setInbox] = useState(inboxInicial);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [provisorios, setProvisorios] = useState<Provisorio[]>([]);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [pendente, iniciar] = useTransition();

  function limparArrasto() {
    setArrasto(null);
    setAlvo(null);
  }

  function moverLead(origem: Extract<Arrasto, { tipo: 'lead' }>, destinoId: string, visual: number) {
    const anterior = colunas;

    const copia = colunas.map((coluna) => ({ ...coluna, cartoes: [...coluna.cartoes] }));
    const colunaOrigem = copia.find((coluna) => coluna.id === origem.colunaId);
    const colunaDestino = copia.find((coluna) => coluna.id === destinoId);
    if (!colunaOrigem || !colunaDestino) return;

    const [cartao] = colunaOrigem.cartoes.splice(origem.indice, 1);
    if (!cartao) return;

    // O índice visual conta com o cartão arrastado ainda no lugar antigo.
    // Na mesma coluna, tirá-lo de lá desloca tudo o que vem depois.
    let indice = visual;
    if (origem.colunaId === destinoId && origem.indice < visual) indice -= 1;
    indice = Math.min(Math.max(indice, 0), colunaDestino.cartoes.length);

    // Soltou no mesmo lugar: não vale uma ida ao banco.
    if (origem.colunaId === destinoId && indice === origem.indice) return;

    colunaDestino.cartoes.splice(indice, 0, cartao);

    setErro(null);
    setColunas(copia);

    iniciar(async () => {
      const resultado = await mover({
        vinculo_id: cartao.vinculo_id,
        stage_id: destinoId,
        indice,
      });

      if (resultado.erro) {
        setColunas(anterior);
        setErro(resultado.erro);
      }
    });
  }

  /**
   * Conversa vira lead.
   *
   * Com telefone lido pela extensão, cria direto. Sem telefone, abre o
   * formulário curto pedindo o número — a mesma regra do painel: lead sem
   * telefone é quase inútil para follow-up, mas telefone adivinhado é pior.
   */
  function criarDeConversa(conversa: CartaoConversa, destinoId: string, visual: number) {
    if (conversa.situacao !== 'nova') return;

    if (!conversa.telefone) {
      setErro(null);
      setConfirmacao({ conversa, stageId: destinoId, indice: visual });
      return;
    }

    executarCriacao(conversa, destinoId, visual);
  }

  function executarCriacao(
    conversa: CartaoConversa,
    destinoId: string,
    indice: number,
    dadosConfirmados?: { nome: string; telefone: string | null },
  ) {
    const inboxAnterior = inbox;
    const provisorio: Provisorio = {
      id: `provisorio-${conversa.id}`,
      colunaId: destinoId,
      nome: dadosConfirmados?.nome ?? conversa.titulo,
    };

    setErro(null);
    setInbox((atual) => atual.filter((item) => item.id !== conversa.id));
    setProvisorios((atual) => [...atual, provisorio]);

    iniciar(async () => {
      const resultado = await criarDaConversa({
        conversa_id: conversa.id,
        stage_id: destinoId,
        indice,
        ...(dadosConfirmados
          ? { nome: dadosConfirmados.nome, telefone: dadosConfirmados.telefone }
          : {}),
      });

      setProvisorios((atual) => atual.filter((item) => item.id !== provisorio.id));

      if (resultado.erro) {
        setInbox(inboxAnterior);
        setErro(resultado.erro);
      }
    });
  }

  return (
    <div className="space-y-3">
      {erro && <p className={ERRO}>{erro}</p>}

      {/* Indicador discreto no lugar de esmaecer o quadro: apagar a tela
          inteira a cada arrasto dá a impressão de que o sistema travou. */}
      <p
        aria-live="polite"
        className={`h-4 text-xs text-neutral-500 transition-opacity ${
          pendente ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Salvando…
      </p>

      <div className="flex gap-4 overflow-x-auto pb-4" aria-busy={pendente}>
        <ColunaInbox
          conversas={inbox}
          arrastando={arrasto?.tipo === 'conversa' ? arrasto.conversa.id : null}
          aoIniciarArrasto={(conversa) => setArrasto({ tipo: 'conversa', conversa })}
          aoTerminarArrasto={limparArrasto}
        />

        {colunas.map((coluna) => (
          <Coluna
            key={coluna.id}
            coluna={coluna}
            colunas={colunas}
            tagsDisponiveis={tagsDisponiveis}
            arrasto={arrasto}
            alvo={alvo}
            provisorios={provisorios.filter((item) => item.colunaId === coluna.id)}
            aoIniciarArrasto={setArrasto}
            aoTerminarArrasto={limparArrasto}
            aoPassarPorCima={setAlvo}
            aoSoltar={(visual) => {
              if (arrasto?.tipo === 'lead') moverLead(arrasto, coluna.id, visual);
              if (arrasto?.tipo === 'conversa') criarDeConversa(arrasto.conversa, coluna.id, visual);
              limparArrasto();
            }}
            aoEscolherEtapa={(cartao, indiceNaOrigem, destinoId) => {
              const destino = colunas.find((item) => item.id === destinoId);
              if (!destino) return;
              moverLead(
                { tipo: 'lead', vinculoId: cartao.vinculo_id, colunaId: coluna.id, indice: indiceNaOrigem },
                destinoId,
                destino.cartoes.length,
              );
            }}
          />
        ))}
      </div>

      {confirmacao && (
        <FormConfirmarTelefone
          confirmacao={confirmacao}
          pendente={pendente}
          aoCancelar={() => setConfirmacao(null)}
          aoConfirmar={(nome, telefone) => {
            const pedido = confirmacao;
            setConfirmacao(null);
            executarCriacao(pedido.conversa, pedido.stageId, pedido.indice, { nome, telefone });
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------- INBOX

function ColunaInbox({
  conversas,
  arrastando,
  aoIniciarArrasto,
  aoTerminarArrasto,
}: {
  conversas: CartaoConversa[];
  arrastando: string | null;
  aoIniciarArrasto: (conversa: CartaoConversa) => void;
  aoTerminarArrasto: () => void;
}) {
  const novas = conversas.filter((conversa) => conversa.situacao === 'nova').length;

  return (
    <section className="flex max-h-[calc(100vh-14rem)] w-72 shrink-0 flex-col rounded-xl border border-dashed border-black/20 bg-black/2 dark:border-white/25 dark:bg-white/2">
      <header className="shrink-0 border-b border-black/10 px-3 py-3 dark:border-white/15">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-neutral-400" aria-hidden />
          <h2 className="truncate text-sm font-semibold">Inbox do WhatsApp</h2>
          <span className="ml-auto rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-white/10 dark:text-neutral-400">
            {novas}
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          Conversas recentes. Arraste para uma etapa para virar lead.
        </p>
      </header>

      <div className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {conversas.length === 0 ? (
          <div className="px-1 py-6 text-center text-xs text-neutral-500">
            <p>Nenhuma conversa capturada ainda.</p>
            <p className="mt-2">
              Abra o WhatsApp Web com a extensão e use <strong>Atualizar conversas</strong> no
              painel.
            </p>
          </div>
        ) : (
          conversas.map((conversa) => (
            <CartaoDaConversa
              key={conversa.id}
              conversa={conversa}
              arrastando={arrastando === conversa.id}
              aoIniciarArrasto={() => aoIniciarArrasto(conversa)}
              aoTerminarArrasto={aoTerminarArrasto}
            />
          ))
        )}
      </div>
    </section>
  );
}

function CartaoDaConversa({
  conversa,
  arrastando,
  aoIniciarArrasto,
  aoTerminarArrasto,
}: {
  conversa: CartaoConversa;
  arrastando: boolean;
  aoIniciarArrasto: () => void;
  aoTerminarArrasto: () => void;
}) {
  const podeArrastar = conversa.situacao === 'nova';

  return (
    <article
      draggable={podeArrastar}
      onDragStart={(evento) => {
        if (!podeArrastar) {
          evento.preventDefault();
          return;
        }
        evento.dataTransfer.setData('text/plain', conversa.id);
        evento.dataTransfer.effectAllowed = 'move';
        aoIniciarArrasto();
      }}
      onDragEnd={aoTerminarArrasto}
      className={`rounded-lg border border-black/10 bg-white p-3 shadow-sm transition dark:border-white/15 dark:bg-neutral-900 ${
        podeArrastar ? 'cursor-grab active:cursor-grabbing' : 'opacity-75'
      } ${arrastando ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-semibold">{conversa.titulo}</p>
        {conversa.eh_grupo && (
          <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-neutral-600 dark:bg-white/10 dark:text-neutral-400">
            Grupo
          </span>
        )}
      </div>

      <p className="mt-1 truncate text-xs text-neutral-600 dark:text-neutral-400">
        {conversa.telefone ? (
          formatarTelefone(conversa.telefone)
        ) : (
          <span className="text-amber-700 dark:text-amber-500">
            Telefone não lido — vai pedir ao soltar
          </span>
        )}
      </p>

      {conversa.situacao === 'ja_e_lead' && (
        <p className="mt-2 text-xs">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Já é lead</span>
          {conversa.lead_id && (
            <>
              {' · '}
              <Link
                href={`/crm/${conversa.lead_id}`}
                className="font-medium text-emerald-700 hover:underline dark:text-emerald-400"
                draggable={false}
              >
                abrir ficha
              </Link>
            </>
          )}
        </p>
      )}

      {conversa.situacao === 'outra_carteira' && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">
          Já é lead de outro vendedor. Fale com o gestor antes de cadastrar de novo.
        </p>
      )}
    </article>
  );
}

// ------------------------------------------------------------------ ETAPAS

function Coluna({
  coluna,
  colunas,
  tagsDisponiveis,
  arrasto,
  alvo,
  provisorios,
  aoIniciarArrasto,
  aoTerminarArrasto,
  aoPassarPorCima,
  aoSoltar,
  aoEscolherEtapa,
}: {
  coluna: ColunaKanban;
  colunas: ColunaKanban[];
  tagsDisponiveis: TagLead[];
  arrasto: Arrasto | null;
  alvo: Alvo | null;
  provisorios: Provisorio[];
  aoIniciarArrasto: (arrasto: Arrasto) => void;
  aoTerminarArrasto: () => void;
  aoPassarPorCima: (alvo: Alvo) => void;
  aoSoltar: (indiceVisual: number) => void;
  aoEscolherEtapa: (cartao: CartaoKanban, indice: number, destinoId: string) => void;
}) {
  const lista = useRef<HTMLDivElement>(null);

  const total = coluna.cartoes.length;
  const soma = coluna.cartoes.reduce((acumulado, cartao) => acumulado + (cartao.valor ?? 0), 0);
  const recebendo = Boolean(arrasto) && alvo?.colunaId === coluna.id;

  return (
    <section
      className={`flex max-h-[calc(100vh-14rem)] w-72 shrink-0 flex-col rounded-xl border transition ${
        recebendo
          ? 'border-emerald-500 bg-emerald-500/5'
          : 'border-black/10 bg-black/2 dark:border-white/15 dark:bg-white/2'
      }`}
      onDragOver={(evento) => {
        if (!arrasto) return;
        // Sem preventDefault o navegador não considera esta área um destino
        // válido e o "drop" nunca chega.
        evento.preventDefault();
        evento.dataTransfer.dropEffect = 'move';
        aoPassarPorCima({
          colunaId: coluna.id,
          indice: calcularIndice(lista.current, evento.clientY),
        });
      }}
      onDrop={(evento) => {
        evento.preventDefault();
        aoSoltar(calcularIndice(lista.current, evento.clientY));
      }}
    >
      <header className="shrink-0 border-b border-black/10 px-3 py-3 dark:border-white/15">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: corDaEtapa(coluna) }}
            aria-hidden
          />
          <h2 className="truncate text-sm font-semibold">{coluna.nome}</h2>
          <span className="ml-auto rounded-full bg-black/5 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-white/10 dark:text-neutral-400">
            {total}
          </span>
        </div>
        <p className="mt-1 text-xs text-neutral-500">{formatarMoeda(soma)}</p>
      </header>

      {/* A coluna rola por dentro. Sem isto, uma etapa com muitos cartões
          estica a página inteira e o cabeçalho das outras colunas some. */}
      <div ref={lista} className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {coluna.cartoes.map((cartao, indice) => (
          <div key={cartao.vinculo_id}>
            {recebendo && alvo?.indice === indice && <Marcador />}
            <Cartao
              cartao={cartao}
              colunas={colunas}
              tagsDisponiveis={tagsDisponiveis}
              colunaId={coluna.id}
              arrastando={arrasto?.tipo === 'lead' && arrasto.vinculoId === cartao.vinculo_id}
              aoIniciarArrasto={() =>
                aoIniciarArrasto({
                  tipo: 'lead',
                  vinculoId: cartao.vinculo_id,
                  colunaId: coluna.id,
                  indice,
                })
              }
              aoTerminarArrasto={aoTerminarArrasto}
              aoEscolherEtapa={(destinoId) => aoEscolherEtapa(cartao, indice, destinoId)}
            />
          </div>
        ))}

        {recebendo && alvo?.indice === total && <Marcador />}

        {provisorios.map((item) => (
          <div
            key={item.id}
            className="rounded-lg border border-dashed border-emerald-500/60 bg-emerald-500/5 p-3 text-sm"
          >
            <p className="truncate font-semibold">{item.nome}</p>
            <p className="mt-1 text-xs text-neutral-500">Criando lead…</p>
          </div>
        ))}

        {total === 0 && provisorios.length === 0 && !recebendo && (
          <p className="px-1 py-6 text-center text-xs text-neutral-500">
            Nenhum lead nesta etapa.
          </p>
        )}
      </div>
    </section>
  );
}

function Marcador() {
  return <div className="mb-2 h-0.5 rounded-full bg-emerald-500" aria-hidden />;
}

function Cartao({
  cartao,
  colunas,
  tagsDisponiveis,
  colunaId,
  arrastando,
  aoIniciarArrasto,
  aoTerminarArrasto,
  aoEscolherEtapa,
}: {
  cartao: CartaoKanban;
  colunas: ColunaKanban[];
  tagsDisponiveis: TagLead[];
  colunaId: string;
  arrastando: boolean;
  aoIniciarArrasto: () => void;
  aoTerminarArrasto: () => void;
  aoEscolherEtapa: (destinoId: string) => void;
}) {
  return (
    <article
      data-cartao
      draggable
      onDragStart={(evento) => {
        // Alguns navegadores só iniciam o arrasto se houver dado no dataTransfer.
        evento.dataTransfer.setData('text/plain', cartao.vinculo_id);
        evento.dataTransfer.effectAllowed = 'move';
        aoIniciarArrasto();
      }}
      onDragEnd={aoTerminarArrasto}
      className={`cursor-grab rounded-lg border border-black/10 bg-white p-3 shadow-sm transition active:cursor-grabbing dark:border-white/15 dark:bg-neutral-900 ${
        arrastando ? 'opacity-40' : ''
      }`}
    >
      <Link
        href={`/crm/${cartao.lead_id}`}
        className="block truncate text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
        // Sem isto, arrastar pelo nome vira "arrastar um link" no Firefox.
        draggable={false}
      >
        {cartao.nome}
      </Link>

      {cartao.telefone && (
        <p className="mt-1 truncate text-xs text-neutral-600 dark:text-neutral-400">
          {cartao.telefone}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{formatarMoeda(cartao.valor)}</span>
        <span className="truncate text-xs text-neutral-500" title={cartao.responsavel?.nome}>
          {cartao.responsavel?.nome ?? 'Sem responsável'}
        </span>
      </div>

      {/* Etiquetas editáveis no próprio cartão: marcar um lead no meio do
          quadro é o momento em que a etiqueta faz falta. */}
      <div className="mt-2">
        <TagsDoLead
          leadId={cartao.lead_id}
          aplicadas={cartao.tags}
          disponiveis={tagsDisponiveis}
          compacto
        />
      </div>

      {cartao.telefone && (
        <div className="mt-3">
          <EnviarMensagem leadId={cartao.lead_id} nome={cartao.nome} variante="discreto" />
        </div>
      )}

      {/* Caminho sem arrastar: telas de toque e teclado. */}
      <label className="mt-3 block sm:hidden">
        <span className="sr-only">Mover {cartao.nome} para outra etapa</span>
        <select
          value={colunaId}
          onChange={(evento) => aoEscolherEtapa(evento.target.value)}
          className="w-full rounded-md border border-black/15 bg-transparent px-2 py-1 text-xs dark:border-white/20"
        >
          {colunas.map((coluna) => (
            <option key={coluna.id} value={coluna.id}>
              {coluna.id === colunaId ? `Etapa: ${coluna.nome}` : `Mover para ${coluna.nome}`}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

/**
 * Só aparece quando a extensão NÃO conseguiu ler o telefone da conversa.
 *
 * Com telefone lido, o arrasto cria direto — o formulário existiria só para
 * atrapalhar. Sem telefone, ele é a diferença entre um lead útil e um cadastro
 * que ninguém consegue contatar.
 */
function FormConfirmarTelefone({
  confirmacao,
  pendente,
  aoCancelar,
  aoConfirmar,
}: {
  confirmacao: Confirmacao;
  pendente: boolean;
  aoCancelar: () => void;
  aoConfirmar: (nome: string, telefone: string | null) => void;
}) {
  const [nome, setNome] = useState(confirmacao.conversa.titulo);
  const [telefone, setTelefone] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        className="w-full max-w-md rounded-xl border border-black/10 bg-white p-6 shadow-xl dark:border-white/15 dark:bg-neutral-900"
        onSubmit={(evento) => {
          evento.preventDefault();
          if (nome.trim().length < 2) return;
          aoConfirmar(nome.trim(), telefone.trim() || null);
        }}
      >
        <h2 className="text-base font-semibold">Confirme o telefone</h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Não foi possível ler o número desta conversa no WhatsApp. Informe se souber — pode ficar
          em branco.
        </p>

        <div className="mt-4">
          <label className={ROTULO} htmlFor="conversa-nome">
            Nome
          </label>
          <input
            id="conversa-nome"
            className={CAMPO}
            value={nome}
            onChange={(evento) => setNome(evento.target.value)}
            minLength={2}
            maxLength={200}
            required
            disabled={pendente}
          />
        </div>

        <div className="mt-4">
          <label className={ROTULO} htmlFor="conversa-telefone">
            Telefone (opcional)
          </label>
          <input
            id="conversa-telefone"
            className={CAMPO}
            type="tel"
            value={telefone}
            onChange={(evento) => setTelefone(evento.target.value)}
            placeholder="(11) 98765-4321"
            disabled={pendente}
            autoFocus
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pendente || nome.trim().length < 2}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            Criar lead
          </button>
          <button type="button" className={BOTAO_MENOR} onClick={aoCancelar} disabled={pendente}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
