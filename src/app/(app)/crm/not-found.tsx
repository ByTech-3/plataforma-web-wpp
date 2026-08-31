import Link from 'next/link';
import { CARTAO } from '@/components/ui';

/**
 * 404 do CRM.
 *
 * O texto é deliberadamente ambíguo entre "não existe" e "não é seu": a RLS
 * também não distingue os dois casos. Responder "existe, mas pertence a outro
 * vendedor" já entregaria a existência do lead a quem não pode vê-lo.
 */
export default function LeadNaoEncontrado() {
  return (
    <div className={`mx-auto max-w-lg ${CARTAO}`}>
      <h1 className="text-lg font-semibold">Lead não encontrado</h1>
      <p className="mt-2 text-sm text-texto-2">
        Ele não existe, foi removido, ou está fora da sua carteira.
      </p>
      <Link
        href="/crm"
        className="mt-4 inline-block text-sm font-medium text-acao hover:underline"
      >
        Voltar para os leads
      </Link>
    </div>
  );
}
