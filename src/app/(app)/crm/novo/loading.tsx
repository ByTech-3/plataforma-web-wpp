import { Barra, FormularioEsqueleto } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Barra className="h-4 w-40" />
      <Barra className="h-8 w-44" />
      <FormularioEsqueleto />
    </div>
  );
}
