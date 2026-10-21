# Estrutura de pastas e arquivos

O papel de cada arquivo do repositório. Para o desenho geral, ver
[arquitetura.md](arquitetura.md).

```
dashboard-vendas-fluxo/
├── .github/workflows/cron.yml    agendador reserva (GitHub Actions)
├── docs/                         esta documentação
├── public/                       logos (claro e escuro)
├── scripts/                      ferramentas de linha de comando (rodam à mão)
├── supabase/migrations/          histórico do schema do banco (SQL)
└── src/
    ├── app/                      telas e rotas de API (App Router do Next.js)
    │   ├── api/cron/             rotas chamadas pelos agendadores
    │   ├── api/dashboard/        rotas lidas pelas telas
    │   └── dashboard/            telas
    ├── components/
    │   ├── dashboard/            componentes de negócio (gráficos, tabelas, seletores)
    │   └── ui/                   componentes base do shadcn
    ├── hooks/                    estado compartilhado das telas
    ├── lib/                      regra de negócio, ingestão e acesso ao banco
    │   ├── auditoria/            saúde da ingestão e idade do dado
    │   ├── exportar/             exportar card como imagem
    │   ├── fontes/               registry de planilhas e pipes, leitores das fontes
    │   ├── ingestao/             rastro de execução, cobertura, botão Atualizar
    │   └── snapshots/            congelamento de períodos fechados
    └── types/                    tipos compartilhados entre API e telas
```

Uma regra para se orientar: **`src/lib/` não depende de `src/app/` nem de
`src/components/`**. As funções de cálculo e de leitura de fonte são puras e
testáveis sem rede; quem faz rede está isolado em poucos arquivos (`sync-*.ts`,
`supabase-*.ts`, `fontes/sheets-fonte.ts`, `auditoria/`, `ingestao/`,
`snapshots/congelar.ts` e `ler.ts`).

---

## Raiz

| Arquivo | Papel |
|---|---|
| `package.json` | Dependências e comandos (`dev`, `build`, `start`, `lint`, `test`, `typecheck`, `knip`) |
| `next.config.ts` | Configuração do Next.js (vazia — usa os padrões) |
| `tsconfig.json` | TypeScript; o alias `@/` aponta para `src/` |
| `eslint.config.mjs` | Lint (regras do Next). Permite `any` só em `scripts/` |
| `vitest.config.ts` | Testes unitários |
| `knip.json` | Detecção de código morto (`npm run knip`). `scripts/*.ts` são pontos de entrada |
| `postcss.config.mjs` | Liga o Tailwind 4 |
| `components.json` | Configuração do CLI do shadcn (para adicionar componentes em `src/components/ui/`) |
| `AGENTS.md` / `CLAUDE.md` | Instruções para assistentes de IA. `CLAUDE.md` só inclui o `AGENTS.md` |
| `.claude/launch.json` | Como o Claude Code sobe o servidor local para visualizar a aplicação |
| `.gitignore` | Inclui `.env*`, `anexos/` e `descoberta-*.json`, que têm credenciais ou dados reais |
| `.github/workflows/cron.yml` | Agendador **reserva** das sincronizações (a cada 6 h e 1×/dia) e disparo manual pelo painel do GitHub. Ver [automacoes.md](automacoes.md) |

## `src/app/` — telas e rotas

### Telas

| Arquivo | Tela |
|---|---|
| `layout.tsx` | Layout raiz: fonte Geist, tema (`ThemeProvider`), título da página |
| `page.tsx` | Redireciona `/` para `/dashboard` |
| `globals.css` | Tokens de cor dos dois temas (claro e escuro) e base do Tailwind |
| `dashboard/page.tsx` | **Visão geral**: KPIs (vendido, projetos, ticket, meta, LTV, valor a fechar), evolução mensal, vendido × meta, canais, top vendedores, tabela por coordenação, funil e tempo no funil, comparativo de gestões |
| `dashboard/funil/page.tsx` | **Funil**: conversão por etapa, tempo médio por fase, funil por coordenação, comparador de fases (De → Para) e comparador periódico de funil |
| `dashboard/vendedores/page.tsx` | **Vendedores**: ranking por volume vendido no período |
| `dashboard/metas/page.tsx` | **Metas**: atingimento geral e por coordenação |
| `dashboard/auditoria/page.tsx` | **Auditoria**: última carga de cada fonte, rejeições, cobertura, snapshots, divergência entre séries de meta, "Conferir um número" |

### Rotas de API

| Arquivo | Método | Papel |
|---|---|---|
| `api/cron/pipefy/route.ts` | POST | Sincroniza o Pipefy. Exige `Authorization: Bearer CRON_SECRET`. `maxDuration` 300 s |
| `api/cron/sheets/route.ts` | POST | Sincroniza as planilhas da gestão vigente. Exige `CRON_SECRET`. `maxDuration` 300 s |
| `api/dashboard/route.ts` | GET | Dados principais (`DashboardData`): vendas, metas, KPIs, coordenações, vendedores, canais, LTV, comparativos, frescor e origem dos números (ao vivo × congelado) |
| `api/dashboard/funil/route.ts` | GET | Funil completo do período (conversão, tempo, por coordenação) |
| `api/dashboard/comparador-fases/route.ts` | GET | Conversão entre duas etapas escolhidas (`etapaDe`, `etapaPara`) |
| `api/dashboard/comparador-funil/route.ts` | GET | Comparativo de duas coortes (períodos A e B) |
| `api/dashboard/origem/route.ts` | GET | Lista de contratos que compõem o total de um período, com a linha da planilha de cada um |
| `api/dashboard/auditoria/route.ts` | GET | Estado de saúde da ingestão |
| `api/dashboard/atualizar/route.ts` | POST | Botão Atualizar: vai às fontes, com trava por cooldown e por execução em andamento. **Não pede segredo** |

## `src/components/dashboard/` — componentes de negócio

| Arquivo | Papel |
|---|---|
| `Sidebar.tsx` | Navegação entre telas e liga/desliga de coordenações |
| `PeriodSelector.tsx` | Seletor de gestão / ciclo / mês. Só oferece períodos que existem e avisa quando a troca de gestão ajusta a seleção |
| `SeletorCoordenacao.tsx` | Escolha de coordenação dentro de uma seção (respeita o recorte da barra lateral) |
| `KpiCard.tsx` | Card de indicador (valor, variação, meta) |
| `SalesOverTime.tsx` | Gráfico de linha: vendas por mês |
| `VendidoVsMeta.tsx` | Barras: gestão atual × anterior, com linha da meta |
| `SalesByChannel.tsx` | Barras: vendido por canal de aquisição |
| `SalesBySeller.tsx` | Barras: vendido por vendedor |
| `CoordTable.tsx` | Tabela por coordenação (vendido, meta, a fechar, negociações); vira cards empilhados no celular |
| `PeriodComparison.tsx` | Período equivalente da gestão anterior e ritmo frente à meta |
| `FunnelChartV2.tsx` | Funis de conversão e de tempo; selo do período (`BadgePeriodo`) |
| `ComparadorFases.tsx` | Conversão De → Para |
| `ComparadorFunilPeriodos.tsx` | Dois funis lado a lado com deltas (coortes A e B) |
| `IdadeDoDado.tsx` | Há quanto tempo cada fonte foi lida (e não há quanto tempo a página abriu) |
| `BadgeOrigem.tsx` | Selo "congelado" / "divergente da fonte" quando os números vêm de um snapshot |
| `ConferirNumero.tsx` | Drill-down: do total até as linhas da planilha |
| `Exportavel.tsx` | Moldura de card com botão de exportar como imagem (com legenda de período, coordenação e idade do dado) |
| `Logo.tsx`, `ThemeToggle.tsx` | Logo que troca com o tema; botão claro/escuro |

`src/components/ui/` são componentes do shadcn (`card`, `select`, `separator`,
`skeleton`, `tabs`, `tooltip`), gerados pelo CLI e quase sem alteração. Para
adicionar outro: `npx shadcn add <componente>`. `src/components/theme-provider.tsx` embrulha o `next-themes`.

## `src/hooks/` e `src/types/`

| Arquivo | Papel |
|---|---|
| `hooks/useDashboardData.ts` | Estado compartilhado das telas: período, coordenações ativas, busca em `/api/dashboard` e o botão Atualizar |
| `types/index.ts` | Tipos que a API devolve e as telas consomem (`DashboardData`, KPIs, funil, comparativos) |

## `src/lib/` — regra de negócio

### Cálculo (puro, sem rede)

| Arquivo | Papel |
|---|---|
| `calculations.ts` | KPIs de vendas: total, meta, por coordenação, vendedor, canal, mês, LTV, comparativo com a gestão anterior |
| `calculations-funil.ts` | Funil: recorte por período e coordenação, conversão, tempo por fase, comparador de fases e comparativo de coortes. **Leia o cabeçalho antes de alterar** |
| `periodo-gestao.ts` | Janelas de gestão, ciclo e mês em horário de Brasília; gestão atual e anterior |
| `periodos-disponiveis.ts` | Quais períodos a tela pode oferecer (e como rotulá-los) |
| `metas-periodo.ts` | Qual meta vale para um período (sem fallback entre níveis) |
| `coordenacoes.ts` | As 5 coordenações e como reconhecer uma num campo de texto livre |
| `colors.ts` | Governança de cores: identidade, alerta e volume ([decisoes.md](decisoes.md)) |
| `utils.ts` | `cn()` para combinar classes do Tailwind |

### Acesso ao banco

| Arquivo | Papel |
|---|---|
| `supabase-vendas.ts` | Lê vendas (com vendedores) e metas do banco |
| `supabase-funil.ts` | Lê cards com o histórico de fases, paginado e ordenado |

### Ingestão

| Arquivo | Papel |
|---|---|
| `sync-pipefy.ts` | Sincroniza os pipes: incremental por `updated_at`, grava `card`, `funil` e vendedores, reconcilia cards que mudaram de fase ou sumiram |
| `sync-sheets.ts` | Sincroniza as planilhas: contratos e metas, linhagem, remoção do que saiu da planilha (com travas) |
| `ingestao/registro.ts` | Abre e fecha `ingestao_execucao` e grava `ingestao_rejeicao` |
| `ingestao/cobertura.ts` | Grava em `cobertura_fonte` o que está declarado em `fontes/cobertura.ts` |
| `ingestao/disparo-manual.ts` | Decide se o botão Atualizar pode disparar (cooldown de 60 s, execução pendurada há mais de 5 min) |

### `fontes/` — o registry e os leitores

| Arquivo | Papel |
|---|---|
| `registry.ts` | **Uma entrada por gestão**: ID da planilha, aba, colunas por nome de cabeçalho, ciclos e layout das metas. Também decide a gestão vigente |
| `pipes.ts` | **Uma entrada por pipe do Pipefy**: nomes de fase → etapa canônica, campos, etapas não instrumentadas, se está encerrado |
| `tipos.ts` | Tipos do registry (`Gestao`, `Ciclo`, `FonteTabela`, `FonteBlocos`) |
| `calendario.ts` | Valida que os ciclos de cada gestão são contíguos e cobrem os 12 meses |
| `cobertura.ts` | Janela de tempo que cada fonte cobre (para distinguir "não medido" de "zero") |
| `sheets-fonte.ts` | Única camada que fala com a API do Google Sheets (somente leitura) |
| `tabela.ts` | Lê a aba de contratos casando colunas pelo nome do cabeçalho |
| `blocos.ts` | Lê a aba "Metas por coordenação", que é um painel de blocos e não uma tabela |
| `normalizar.ts` | Normaliza cabeçalhos (acentos, espaços, `º` × `°`) |
| `mapear.ts` | Converte o lido em linhas do banco; identidade de contrato e de meta; nomes de vendedor |

### `auditoria/`, `snapshots/`, `exportar/`

| Arquivo | Papel |
|---|---|
| `auditoria/coletar.ts` | Monta o estado da tela de Auditoria (execuções, pendências, cobertura, snapshots) |
| `auditoria/frescor.ts` | Idade do dado por fonte; limites de 3 h (Pipefy) e 30 h (planilhas) |
| `snapshots/metricas.ts` | O que é congelado, `VERSAO_CALCULO` e o hash que prova que não mudou |
| `snapshots/congelar.ts` | Quais períodos já podem ser congelados (1 mês de carência) e gravação |
| `snapshots/ler.ts` | Lê o snapshot e compara com a fonte de hoje |
| `exportar/imagem.ts` | Captura o card da tela como PNG |
| `exportar/legenda.ts` | Texto do rodapé da imagem e nome do arquivo |

### Testes

Ficam ao lado do código (`*.test.ts`), 14 arquivos. Rodam sem rede e sem banco:
`npm test`.

## `scripts/` — ferramentas de linha de comando

Rodam da máquina de quem tem o `.env.local`, com `npx tsx scripts/<nome>.ts`.
Todos começam com um comentário explicando uso e flags.

| Script | Tipo | Papel |
|---|---|---|
| `backfill-pipefy.ts` | Escreve | Carga completa de todos os pipes, inclusive o encerrado. `--pipe`, `--limpar` |
| `backfill-sheets.ts` | Escreve | Carga completa de todas as gestões do registry. `--gestao`, `--simular`, `--limpar` |
| `congelar-periodos.ts` | Escreve | Congela os períodos fechados. Sem `--gravar` só mostra o que faria |
| `registrar-cobertura.ts` | Escreve | Regrava `cobertura_fonte` quando a declaração muda |
| `auditar-banco.ts` | Lê | Confere invariantes do banco contra registry e planilhas |
| `verificar-registry.ts` | Lê | Lê as planilhas reais pelo registry e mostra o que extraiu. `--gestao` |
| `inspecionar-planilha.ts` | Lê | Descoberta: analisa uma planilha nova (abas, cabeçalhos, blocos) |
| `inspecionar-pipe.ts` | Lê | Descoberta: lista pipes, fases e campos. `--listar` |

## `supabase/migrations/`

Histórico do schema, em ordem. Cada arquivo começa explicando o problema que
resolveu. Detalhes das tabelas: [dados.md](dados.md).

| Migration | O que fez |
|---|---|
| `0001_baseline.sql` | Retrato do schema em 01/08/2026 (sem RLS, grants e funções) |
| `0002_registry_de_fontes.sql` | Gestões sem lista fixa; coluna `valor_vendido_real` |
| `0003_rastro_de_ingestao.sql` | `ingestao_execucao`, `ingestao_rejeicao` e linhagem (`origem_ref`) |
| `0004_multi_pipe_e_fuso.sql` | `card.pipe_id`, datas com fuso (`timestamptz`), `cobertura_fonte` |
| `0005_cobertura_nulls_not_distinct.sql` | Corrige a unicidade de `cobertura_fonte` com `gestao` nula |
| `0006_snapshots_de_periodo.sql` | `snapshot_periodo` com gatilho que recusa UPDATE |
| `0007_agendamento_no_banco.sql` | `pg_cron` + `pg_net` + `disparar_sync()` |
| `0008_disparo_observavel.sql` | View `disparo_recente` com as respostas HTTP |
| `0009_url_verificavel.sql` | `url_do_disparo()` para conferir a URL sem disparar |
| `0010_identidade_do_contrato.sql` | Contrato identificado por gestão + nome + coordenação + mês |

## `docs/`

| Arquivo | Conteúdo |
|---|---|
| [README.md](README.md) | Índice e por onde começar |
| [arquitetura.md](arquitetura.md) | Desenho geral e diagramas |
| [estrutura.md](estrutura.md) | Este arquivo |
| [dados.md](dados.md) | Domínio, fontes e banco |
| [automacoes.md](automacoes.md) | Agendamentos, segredos e diagnóstico |
| [operacao.md](operacao.md) | Procedimentos do dia a dia |
| [decisoes.md](decisoes.md) | Decisões e peculiaridades |
| [pendencias.md](pendencias.md) | Riscos, bugs conhecidos e dívidas |

O plano e o contexto originais e o registro da passagem de responsabilidade
ficam no **repositório privado de arquivo**, junto com o histórico completo do
git, porque citam dados reais.
