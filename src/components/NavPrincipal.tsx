'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITENS = [
  { href: '/dashboard', rotulo: 'Painel' },
  { href: '/crm', rotulo: 'CRM' },
  { href: '/kanban', rotulo: 'Kanban' },
  { href: '/configuracoes', rotulo: 'Configurações' },
];

export function NavPrincipal() {
  const caminho = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {ITENS.map((item) => {
        const ativo = caminho === item.href || caminho.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? 'page' : undefined}
            className={
              ativo
                ? 'rounded-md bg-black/5 px-3 py-1.5 text-sm font-semibold dark:bg-white/10'
                : 'rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-black/5 dark:text-neutral-400 dark:hover:bg-white/10'
            }
          >
            {item.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
