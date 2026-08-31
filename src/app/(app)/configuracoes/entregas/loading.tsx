import { Barra, CabecalhoEsqueleto, TabelaEsqueleto } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <Barra className="h-4 w-48" />
      <CabecalhoEsqueleto />
      <TabelaEsqueleto linhas={10} />
    </div>
  );
}
