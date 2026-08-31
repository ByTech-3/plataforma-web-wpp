import { Barra, CabecalhoEsqueleto } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <Barra className="h-4 w-40" />
      <CabecalhoEsqueleto acoes={2} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Ficha do lead. */}
        <div className="space-y-4 rounded-grande border border-linha p-5 lg:col-span-2">
          {Array.from({ length: 6 }, (_, indice) => (
            <div key={indice} className="space-y-1.5">
              <Barra className="h-3 w-20" />
              <Barra className="h-4 w-48" />
            </div>
          ))}
        </div>

        {/* Linha do tempo: bolinha + texto, como os eventos de verdade. */}
        <div className="space-y-4 rounded-grande border border-linha p-5">
          <Barra className="h-4 w-32" />
          {Array.from({ length: 5 }, (_, indice) => (
            <div key={indice} className="flex gap-3">
              <Barra className="mt-1.5 h-2 w-2 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Barra className="h-4 w-3/4" />
                <Barra className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
