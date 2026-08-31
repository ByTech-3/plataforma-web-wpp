'use client';

/**
 * Navegação principal.
 *
 * Barra lateral fixa no desktop porque o menu horizontal já estava com quatro
 * itens e vai crescer (Inbox, fluxos, equipe) — em linha, cada item novo
 * aperta os outros. No celular vira uma barra inferior, que é onde o polegar
 * alcança.
 *
 * Ícones em SVG inline: nenhuma dependência nova, e o ícone acompanha a cor do
 * texto sem truque.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { href: string; rotulo: string; icone: React.ReactNode };

const TRACO = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const ITENS: Item[] = [
  {
    href: '/dashboard',
    rotulo: 'Painel',
    icone: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO}>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V21h14V9.5" />
      </svg>
    ),
  },
  {
    href: '/crm',
    rotulo: 'Leads',
    icone: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
        <path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 20a5.4 5.4 0 0 0-2.2-4.3" />
      </svg>
    ),
  },
  {
    href: '/kanban',
    rotulo: 'Kanban',
    icone: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO}>
        <rect x="3" y="4" width="5.5" height="16" rx="1.5" />
        <rect x="10.2" y="4" width="5.5" height="10" rx="1.5" />
        <rect x="17.5" y="4" width="3.5" height="13" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/configuracoes',
    rotulo: 'Configurações',
    icone: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
      </svg>
    ),
  },
];

function estaAtivo(caminho: string, href: string): boolean {
  // `/funis` faz parte de Configurações, embora tenha rota própria.
  if (href === '/configuracoes') {
    return caminho.startsWith('/configuracoes') || caminho.startsWith('/funis');
  }
  return caminho === href || caminho.startsWith(`${href}/`);
}

export function BarraLateral() {
  const caminho = usePathname();

  return (
    <>
      {/* Desktop: coluna fixa à esquerda. */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-linha bg-superficie px-3 py-5 md:flex"
      >
        <div className="px-3 pb-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-texto-3">
            ByTech3
          </p>
          <p className="mt-0.5 text-sm font-semibold text-texto">Plataforma</p>
        </div>

        <ul className="flex flex-1 flex-col gap-1">
          {ITENS.map((item) => {
            const ativo = estaAtivo(caminho, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={ativo ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-padrao px-3 py-2.5 text-sm transition ${
                    ativo
                      ? 'bg-superficie-2 font-semibold text-texto'
                      : 'font-medium text-texto-2 hover:bg-superficie-2 hover:text-texto'
                  }`}
                >
                  <span className={ativo ? 'text-acao' : 'text-texto-3'}>{item.icone}</span>
                  {item.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Celular: barra inferior, ao alcance do polegar. */}
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-linha bg-superficie md:hidden"
      >
        {ITENS.map((item) => {
          const ativo = estaAtivo(caminho, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={ativo ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] transition ${
                ativo ? 'font-semibold text-acao' : 'text-texto-2'
              }`}
            >
              {item.icone}
              {item.rotulo}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
