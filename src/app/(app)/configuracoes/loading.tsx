import { Barra, CabecalhoEsqueleto, CartoesEsqueleto } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <CabecalhoEsqueleto />
      <CartoesEsqueleto quantidade={2} />
      <div className="space-y-4 rounded-grande border border-linha p-5">
        <Barra className="h-4 w-28" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Barra className="h-10" />
          <Barra className="h-10" />
          <Barra className="h-10" />
        </div>
      </div>
    </div>
  );
}
