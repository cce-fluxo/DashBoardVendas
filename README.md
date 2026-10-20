# Dashboard Comercial Fluxo

Dashboard interno de vendas e funil comercial da Fluxo Consultoria. Mostra o que
foi vendido frente às metas, por gestão, ciclo, mês, coordenação, vendedor e
canal, e como o funil comercial está convertendo.

- **Vendas e metas** vêm das planilhas oficiais de cada gestão (Google Sheets).
- **Funil** vem do CRM (Pipefy).
- As duas fontes são sincronizadas para um banco **Supabase**, e as telas leem
  só dele.

A URL de produção fica no projeto da Vercel. Ela não é publicada neste
repositório, que é público e o dashboard ainda não tem login
([pendências](docs/pendencias.md)).

## Começando

Requisitos: Node.js 20.9+ e as credenciais do projeto (cofre de senhas da empresa).

```bash
npm install
npm run dev
```

Antes, crie o `.env.local` com as variáveis listadas em
[docs/operacao.md](docs/operacao.md#rodar-localmente). Atenção: existe **um banco
só**, e o ambiente local usa o mesmo banco da produção.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor local em <http://localhost:3000> |
| `npm run build` | Build de produção |
| `npm run typecheck` | Checagem de tipos |
| `npm run lint` | ESLint |
| `npm test` | Testes (Vitest) |
| `npm run knip` | Código, arquivos e dependências sem uso |
| `npx tsx scripts/<nome>.ts` | Ferramentas de carga, auditoria e descoberta ([lista](docs/estrutura.md#scripts--ferramentas-de-linha-de-comando)) |

## Documentação

| Documento | Para quê |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Como as peças se conectam, com diagramas |
| [docs/estrutura.md](docs/estrutura.md) | O papel de cada pasta e arquivo |
| [docs/dados.md](docs/dados.md) | Gestão, ciclos, funil, metas; planilhas, pipes e tabelas do banco |
| [docs/automacoes.md](docs/automacoes.md) | Agendamentos, segredos e diagnóstico de falhas |
| [docs/operacao.md](docs/operacao.md) | Passo a passo: rodar, publicar, virada de gestão, congelar períodos, trocar segredos |
| [docs/decisoes.md](docs/decisoes.md) | Por que as coisas são como são |
| [docs/pendencias.md](docs/pendencias.md) | Riscos, bugs conhecidos e dívidas |

Comece por [docs/README.md](docs/README.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · shadcn ·
Recharts · Supabase (Postgres, `pg_cron`, Vault) · Vercel · GitHub Actions.

> **Next.js 16 tem mudanças incompatíveis** com versões anteriores. Antes de
> mexer em convenções do framework, consulte `node_modules/next/dist/docs/`.
