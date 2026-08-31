import {
  Barra,
  CabecalhoEsqueleto,
  FiltrosEsqueleto,
  TabelaEsqueleto,
} from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <CabecalhoEsqueleto acoes={1} />

      {/* As duas abas "Ativos" / "Incluir arquivados". */}
      <div className="flex items-center gap-2">
        <Barra className="h-8 w-28" />
        <Barra className="h-8 w-44" />
      </div>

      <FiltrosEsqueleto />
      <TabelaEsqueleto />
    </div>
  );
}
