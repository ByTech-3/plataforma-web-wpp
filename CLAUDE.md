# app-web

> A especificação mestre do produto é o **`../CLAUDE.md`**, na raiz do monorepo.
> Leia-o antes de mexer em qualquer coisa aqui. Este arquivo só acrescenta as
> regras específicas do Next.js.

Regras locais:

- Nenhuma decisão de segurança vive no frontend. O isolamento entre empresas é
  garantido pela RLS no Supabase (ver `../supabase/migrations/`).
- Só a chave `anon` entra em variáveis `NEXT_PUBLIC_*`. A `service_role` jamais.

@AGENTS.md
