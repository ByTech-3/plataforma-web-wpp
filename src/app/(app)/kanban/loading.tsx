import { CabecalhoEsqueleto, FiltrosEsqueleto, QuadroEsqueleto } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <CabecalhoEsqueleto acoes={3} />
      <FiltrosEsqueleto />
      {/* A primeira coluna é sempre a Inbox, então há uma a mais que as etapas. */}
      <QuadroEsqueleto colunas={5} />
    </div>
  );
}
