import { redirect } from 'next/navigation';

/**
 * A raiz não tem conteúdo próprio: manda para o painel.
 * Quem não tem sessão nem chega aqui — o proxy.ts já desviou para /login.
 */
export default function Home() {
  redirect('/dashboard');
}
