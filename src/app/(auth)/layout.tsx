import type { ReactNode } from 'react';
import Link from 'next/link';

/** Moldura das telas públicas (login e cadastro). */
export default function LayoutAutenticacao({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="block text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
            ByTech3
          </p>
          <p className="mt-1 text-lg font-semibold tracking-tight">
            CRM integrado ao WhatsApp
          </p>
        </Link>

        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
