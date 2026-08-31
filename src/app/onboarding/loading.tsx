import { Barra, FormularioEsqueleto } from '@/components/Esqueleto';

export default function Carregando() {
  return (
    <div className="mx-auto max-w-md space-y-6 px-5 py-16">
      <Barra className="h-8 w-56" />
      <Barra className="h-4 w-full" />
      <FormularioEsqueleto campos={2} />
    </div>
  );
}
