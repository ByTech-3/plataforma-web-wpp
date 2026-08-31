import { Barra, CabecalhoEsqueleto } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <Barra className="h-4 w-44" />
      <CabecalhoEsqueleto />
      <div className="space-y-3 rounded-grande border border-linha p-5">
        {Array.from({ length: 5 }, (_, indice) => (
          <div key={indice} className="flex items-center gap-3">
            <Barra className="h-4 w-4" />
            <Barra className="h-6 w-40 rounded-full" />
            <Barra className="h-4 flex-1" />
            <Barra className="h-8 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
