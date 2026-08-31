import { Barra } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="space-y-6">
      <Barra className="h-4 w-40" />
      <Barra className="h-8 w-64" />

      {/* Simulador, gatilhos, ações e ativação — os quatro cartões da tela. */}
      {[3, 3, 4, 5].map((linhas, indice) => (
        <div key={indice} className="space-y-3 rounded-grande bg-superficie p-6 shadow-carta">
          <Barra className="h-4 w-44" />
          {Array.from({ length: linhas }, (_, item) => (
            <Barra key={item} className="h-10 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
