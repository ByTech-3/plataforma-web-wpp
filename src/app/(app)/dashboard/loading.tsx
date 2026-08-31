import { Barra, CabecalhoEsqueleto, CartoesEsqueleto } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-8">
      <CabecalhoEsqueleto />
      <CartoesEsqueleto quantidade={3} colunas="sm:grid-cols-3" />
      <CartoesEsqueleto quantidade={2} />
      <div className="space-y-3 rounded-grande border border-linha p-5">
        <Barra className="h-4 w-24" />
        <Barra className="h-3 w-full" />
        <Barra className="h-3 w-5/6" />
      </div>
    </div>
  );
}
