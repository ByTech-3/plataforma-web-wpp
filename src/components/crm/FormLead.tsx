'use client';

/**
 * Formulário de lead — serve para criar e para editar.
 *
 * A validação daqui é conveniência (avisar antes de ir ao servidor). Quem
 * decide de verdade é o banco: lista fixa de origem por `check`, responsável
 * conferido por trigger, licença e carteira por RLS. Por isso o erro devolvido
 * pela Server Action é exibido do mesmo jeito que os erros locais — para o
 * usuário, é tudo "o sistema não aceitou, e este é o motivo".
 */
import { useActionState } from 'react';
import Link from 'next/link';
import { BOTAO_PRIMARIO, CAMPO, ERRO, ROTULO } from '@/components/ui';
import {
  ESTADO_FORM_INICIAL,
  ORIGENS_LEAD,
  ORIGEM_PADRAO,
  type EstadoFormLead,
  type LeadDaTela,
  type MembroOrg,
} from '@/lib/crm/tipos';

type Props = {
  acao: (estado: EstadoFormLead, dados: FormData) => Promise<EstadoFormLead>;
  membros: MembroOrg[];
  usuarioId: string;
  /** Gestor/admin distribuem leads; vendedor só pega para si (regra de carteira). */
  podeDistribuir: boolean;
  lead?: LeadDaTela | null;
  rotuloEnvio: string;
  rotuloEnviando: string;
  urlCancelar: string;
  /** Ex.: "Ele entra em Funil principal, na etapa Novo." */
  avisoFunil?: string | null;
};

export function FormLead({
  acao,
  membros,
  usuarioId,
  podeDistribuir,
  lead = null,
  rotuloEnvio,
  rotuloEnviando,
  urlCancelar,
  avisoFunil = null,
}: Props) {
  const [estado, enviar, enviando] = useActionState(acao, ESTADO_FORM_INICIAL);

  const iniciais = estado.valores ?? {
    nome: lead?.nome ?? '',
    telefone: lead?.telefone ?? '',
    email: lead?.email ?? '',
    origem: lead?.origem ?? ORIGEM_PADRAO,
    responsavel_id: lead?.responsavel_id ?? '',
    valor: lead?.valor !== null && lead?.valor !== undefined ? String(lead.valor) : '',
    previsao_fechamento: lead?.previsao_fechamento ?? '',
  };

  // Vendedor não distribui lead para colega — a policy de INSERT recusaria.
  // O responsável já gravado continua na lista para a edição não trocá-lo sem
  // que ninguém tenha pedido.
  const opcoes = podeDistribuir
    ? membros
    : membros.filter(
        (membro) => membro.user_id === usuarioId || membro.user_id === lead?.responsavel_id,
      );

  return (
    <form action={enviar} className="space-y-5">
      {lead && <input type="hidden" name="lead_id" value={lead.id} />}

      {estado.erro && <p className={ERRO}>{estado.erro}</p>}

      {/* `key` remonta os campos quando a ação volta com erro, para eles
          reassumirem os valores digitados em vez de voltarem em branco. */}
      <div key={estado.tentativa} className="space-y-5">
        <div>
          <label className={ROTULO} htmlFor="nome">
            Nome <span className="text-perigo">*</span>
          </label>
          <input
            id="nome"
            name="nome"
            type="text"
            required
            minLength={2}
            maxLength={200}
            defaultValue={iniciais.nome}
            autoComplete="off"
            placeholder="Maria Souza"
            className={CAMPO}
            disabled={enviando}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={ROTULO} htmlFor="telefone">
              Telefone
            </label>
            <input
              id="telefone"
              name="telefone"
              type="tel"
              maxLength={40}
              defaultValue={iniciais.telefone}
              placeholder="(11) 90000-0000"
              className={CAMPO}
              disabled={enviando}
            />
          </div>

          <div>
            <label className={ROTULO} htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              maxLength={200}
              defaultValue={iniciais.email}
              className={CAMPO}
              disabled={enviando}
            />
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={ROTULO} htmlFor="origem">
              Origem
            </label>
            <select
              id="origem"
              name="origem"
              defaultValue={iniciais.origem}
              className={CAMPO}
              disabled={enviando}
            >
              {ORIGENS_LEAD.map((origem) => (
                <option key={origem} value={origem}>
                  {origem}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-texto-3">
              Lista fixa. Sem informação, fica como {ORIGEM_PADRAO}.
            </p>
          </div>

          <div>
            <label className={ROTULO} htmlFor="responsavel_id">
              Responsável
            </label>
            <select
              id="responsavel_id"
              name="responsavel_id"
              defaultValue={iniciais.responsavel_id}
              className={CAMPO}
              disabled={enviando}
            >
              <option value="">Sem responsável (fica no pool da equipe)</option>
              {opcoes.map((membro) => (
                <option key={membro.user_id} value={membro.user_id}>
                  {membro.nome}
                  {membro.user_id === usuarioId ? ' (você)' : ''}
                </option>
              ))}
            </select>
            {!podeDistribuir && (
              <p className="mt-1.5 text-xs text-texto-3">
                Como vendedor, você atribui o lead a si mesmo ou deixa sem responsável.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className={ROTULO} htmlFor="valor">
              Valor do negócio (R$)
            </label>
            <input
              id="valor"
              name="valor"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              defaultValue={iniciais.valor}
              placeholder="0,00"
              className={CAMPO}
              disabled={enviando}
            />
          </div>

          <div>
            <label className={ROTULO} htmlFor="previsao_fechamento">
              Previsão de fechamento
            </label>
            <input
              id="previsao_fechamento"
              name="previsao_fechamento"
              type="date"
              defaultValue={iniciais.previsao_fechamento}
              className={CAMPO}
              disabled={enviando}
            />
          </div>
        </div>
      </div>

      {avisoFunil && <p className="text-xs text-texto-3">{avisoFunil}</p>}

      <div className="flex items-center gap-3">
        <button type="submit" className={`${BOTAO_PRIMARIO} sm:w-auto`} disabled={enviando}>
          {enviando ? rotuloEnviando : rotuloEnvio}
        </button>
        <Link
          href={urlCancelar}
          className="rounded-padrao border border-linha-forte px-4 py-2.5 text-sm font-medium transition hover:bg-superficie-2"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
