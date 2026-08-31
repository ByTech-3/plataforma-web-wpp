import { CabecalhoEsqueleto, CartoesEsqueleto } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <CabecalhoEsqueleto />
      <CartoesEsqueleto quantidade={3} />
    </div>
  );
}
