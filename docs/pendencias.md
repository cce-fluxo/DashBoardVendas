# Pendências, riscos e dívidas

O que está conhecido e ainda não resolvido, na ordem em que eu atacaria.
Atualizado em outubro de 2026, na passagem para a área de tecnologia.

## Riscos

### 🔴 O dashboard não tem login — **precisa ser feito**

Não há autenticação, middleware nem proteção de deploy na Vercel. Quem tiver a
URL de produção vê os números de vendas, metas e nomes de vendedores, e chama as
rotas de leitura da API.

**Decisão de 20/10/2026:** seguir sem login por enquanto, porque todas as pessoas
da organização já têm acesso às planilhas de origem. O login continua
obrigatório como próximo passo. Com o repositório **público**, o risco não se
limita à organização: a única barreira é a URL não estar publicada em lugar
nenhum. Por isso ela foi retirada do repositório, e não deve voltar para ele
(nem em issue, PR ou comentário).

A empresa não tem domínio de e-mail próprio, então "aceitar só e-mails da
empresa" não é possível. Caminhos viáveis:

- **Login com Google pelo Supabase Auth com lista de e-mails autorizados**
  (contas pessoais de quem usa o dashboard). Gratuito; a lista vira uma tabela no
  banco ou uma variável de ambiente. É o recomendado.
- **Link mágico por e-mail** (Supabase Auth) com a mesma lista. Exige um serviço
  de envio de e-mail próprio, porque o envio gratuito do Supabase é muito limitado.
- **Senha compartilhada** num `proxy.ts` (o antigo middleware, no Next 16). Rápido,
  mas fraco: precisa ser trocada sempre que alguém sai.

Em qualquer caso, `/api/cron/*` fica fora do login (já exige `CRON_SECRET`) e
`/api/dashboard/atualizar` passa a exigir sessão. A proteção nativa da Vercel
(Deployment Protection) não cobre o domínio de produção nos planos Hobby e Pro
sem adicional pago.

### 🟠 Plano Hobby da Vercel e repositório público

**Decisão de 20/10/2026:** manter a Vercel no plano gratuito e publicar o
repositório como **público** na organização da área de tecnologia. No Hobby, a
Vercel só faz deploy de repositório de organização se ele for público, e só
assim commits de outras pessoas além do dono da conta são publicados.

Consequências que precisam continuar valendo:

- **Nada sensível entra no repositório**: credenciais, URL de produção, nomes de
  clientes ou vendedores, valores reais. Exemplos em testes e comentários usam
  dados fictícios.
- **Os logs do GitHub Actions são públicos.** O workflow de sincronização imprime
  só o status e as contagens, nunca o corpo inteiro da resposta.
- **Deploys de preview** precisam continuar protegidos (Vercel → Settings →
  Deployment Protection → *Standard Protection*), porque usam o banco de produção.
- O histórico completo, o plano original e o registro da passagem ficam num
  **repositório privado de arquivo**, sem deploy.
- Os termos do plano Hobby vedam uso comercial; o entendimento atual é que o uso
  interno e restrito não se enquadra. Em caso de dúvida, confirmar com o suporte
  da Vercel.

### 🟠 Token do Pipefy pessoal

O `PIPEFY_TOKEN` foi gerado com o usuário de uma pessoa. Se esse acesso for
removido ou a pessoa sair, a sincronização do funil para (a idade do dado e a
Auditoria acusam em até 3 h). Decisão atual: manter por enquanto. Quando trocar,
gerar com uma conta que não dependa de uma pessoa.

### 🟡 Gestão 26/27 ainda incompleta na planilha

Cadastrada em 21/10/2026. Duas coisas dependem da planilha e de acompanhamento:

- **Nomes dos ciclos 2 a 4** ainda são provisórios ("Ciclo 2", "Ciclo 3",
  "Ciclo 4"). Quando a planilha revelar o nome, a sincronização avisa; atualize
  o `rotulo` em `src/lib/fontes/registry.ts` e remova `rotuloProvisorio`. Trocar
  também o `id` só é seguro antes de o ciclo ser congelado.
- **Metas** só estão preenchidas para outubro e para o Ciclo Gambito, e o bloco
  GESTÃO está vazio. Até ser preenchido, a meta anual não aparece (e não é
  inventada somando ciclos que faltam).

### 🟡 Congelamento de períodos é manual

A gestão 25/26 e o Ciclo Apollo ficam liberados para congelar a partir de
01/11/2026. Se ninguém rodar o script, os números seguem ao vivo e uma correção
na planilha muda retroativamente o que já foi reportado.
Procedimento: [operacao.md](operacao.md#congelar-períodos-fechados).

### 🟡 Um único banco para tudo

Produção, previews e desenvolvimento local usam o mesmo Supabase. Um script ou
um teste manual num preview escreve nos dados reais. Um projeto Supabase
separado para desenvolvimento resolveria.

### 🟡 Botão Atualizar sem autenticação

`POST /api/dashboard/atualizar` dispara leituras no Pipefy e no Google Sheets sem
segredo; a única proteção é o cooldown de 60 s por fonte. Com login, a rota
passaria a exigir sessão.

### 🟡 A conferir no Supabase

- Plano e política de **backup** do projeto.
- `0001_baseline.sql` não registra RLS, grants e sequences: o estado real só está
  no painel. Vale exportar com `pg_dump --schema-only` e versionar.

## Bugs conhecidos

- **Rótulos de valor ao lado das barras não aparecem** em `VendidoVsMeta` e
  `SalesBySeller` (componente `LabelValor` em `<LabelList content={...}>`). O
  Recharts 3 não desenha os textos; acontece também na produção atual.

## Dívidas técnicas

- **Sem CI de qualidade.** O único workflow do GitHub é o agendador reserva.
  Um workflow que rode `typecheck`, `lint`, `test`, `knip` e `build` em cada PR
  evitaria regressões.
- **Busca de dados em `useEffect`** nas telas (seis `eslint-disable`
  justificados). Migrar para SWR ou React Query.
- **Testes cobrem só `src/lib/`.** Rotas de API e componentes não têm teste.
- **Migrations aplicadas à mão** no SQL Editor, sem controle de quais já rodaram
  além do próprio histórico.

## Ideias em aberto (produto)

- Modo "as-of" no comparador de funil: o motor já suporta, falta a interface.
- Comparação por coordenação no comparador periódico de funil.
- Histograma de ticket médio.
