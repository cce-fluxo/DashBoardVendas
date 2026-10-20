# Decisões e peculiaridades

O porquê das escolhas que não são óbvias lendo o código. Antes de "simplificar"
algo desta lista, leia o motivo: quase tudo aqui nasceu de um erro real em
produção.

O raciocínio completo de cada fase está no plano e no contexto originais do
projeto (`PLANO-FONTE-DA-VERDADE.md` e `CONTEXTO-PROJETO.md`), guardados no
repositório privado de arquivo porque citam dados reais. Os comentários no
topo dos arquivos também explicam a história de cada módulo.

## Princípios

1. **Nenhum descarte silencioso.** Toda linha ou card que não vira dado grava
   motivo e payload em `ingestao_rejeicao`. Contador num `catch` não conta como
   registro.
2. **A tela nunca oferece uma escolha que não existe** (períodos, gestões e
   coordenações vêm do dado ou do registry, nunca de lista fixa).
3. **Ausência é explicada, não é zero.** "Não medido", "ainda não aconteceu" e
   "zero de verdade" aparecem diferentes.
4. **Nenhum número sem origem.** Cada venda e meta aponta para a célula de onde
   veio; a tela diz se o número é ao vivo ou congelado e qual a idade do dado.
5. **Definição única.** Calendário, coordenações, mapas de fase e regra de meta
   existem em um só lugar. Cópias divergiram toda vez que existiram.

## Fontes e ingestão

| Decisão | Por quê |
|---|---|
| **Telas leem só o banco** | A cota do Google Sheets derrubava a tela com poucas pessoas acessando; sem banco não há snapshot nem auditoria |
| **Colunas casadas pelo nome do cabeçalho** (`fontes/tabela.ts`) | O leitor antigo usava `row[13]`: inserir uma coluna deslocava tudo em silêncio. Agora coluna sumida é erro com o nome dela |
| **Coluna do mês por posição** | É a única sem cabeçalho utilizável nas três planilhas |
| **Ciclos declarados no registry, não lidos da planilha** | São um fato decidido uma vez por gestão, e a planilha tem erro (o "Ciclo Andes" de 23/24 termina em 30/05, deixando 31/05 órfão). Declarados por mês, o buraco é impossível |
| **IDs de planilha e de pipe no código** | São identificadores, não segredos. O acesso é controlado pelo compartilhamento e pelo token |
| **Ciclo de meta casado pela data FIM** | Os nomes dos ciclos só são revelados ao longo da gestão ("Ciclo XXX") |
| **Nunca derivar o ano do rótulo de mês na aba de metas** | Em 25/26 os rótulos dizem "outubro/2024"; os valores estão certos |
| **Sincronização incremental do Pipefy** | A varredura completa a cada 30 min levava 275 s e estourava o limite da função (504). Pulando cards sem `updated_at` novo, fecha em ~9 s |
| **Fases terminais fora da varredura do cron** | 94% dos cards já são terminais e não mudam. Card que vira terminal entre duas rodadas é achado pela **reconciliação**, que consulta o estado dele no Pipefy |
| **Remoção do que sumiu da planilha só na gestão lida e nunca com leitura vazia** | Leitura vazia costuma ser falha de acesso; apagar nesse caso limparia a gestão inteira |
| **Banco guarda `coordenacoes` cru do Pipefy** | O campo é texto livre. Filtrar na ingestão perderia informação; quem decide o que é coordenação é a leitura (`ehCoordenacao`) |
| **Sem tabela de apelidos de vendedor** | Um apelido em 23/24 e um nome completo em 25/26 podem ou não ser a mesma pessoa, e não há como saber. Nome não identificável é vendedor distinto; casamento aproximado inventaria identidade |
| **Paginar e ordenar toda leitura grande** | O limite de 1.000 linhas do Supabase truncou contagens quatro vezes. Paginar sem `ORDER BY` repetia e perdia linhas entre páginas |
| **Webhook do Pipefy removido** | Não tinha autenticação, estava desatualizado e descartava cards em silêncio. Com o `pg_cron` pontual, deixou de ser necessário |

## Agendamento

| Decisão | Por quê |
|---|---|
| **`pg_cron` no Supabase como agendador principal** | O agendamento do GitHub Actions atrasa e descarta execuções: em agosto de 2026, 64% das rodadas a cada 30 min nunca aconteceram |
| **GitHub Actions como reserva a cada 6 h** | Reserva frequente esconderia a queda do principal. Com 6 h contra limite de frescor de 3 h, o alarme dispara mesmo com a reserva rodando |
| **Segredos do agendador no Vault, não na migration** | Migration é versionada no git |
| **Botão Atualizar vai à fonte, sem segredo, com cooldown** | Antes ele só relia o banco e mostrava o mesmo número. O navegador não tem onde guardar segredo; a trava de 60 s protege a cota |
| **Idade do dado no cabeçalho** | A tela dizia "atualizado agora" com o agendador parado havia 10 horas. Não dá para garantir a carga; dá para garantir que a tela não minta sobre ela |

## Cálculo

| Decisão | Por quê |
|---|---|
| **Valor de venda = "Valor Vendido real"** | É o que de fato entrou. "Valor contrato" diverge (mais de duzentos mil reais em 23/24). Decisão do dono do processo |
| **Base do funil = Oportunidade** | Todos os cards passam por ela e ela existe nos dois pipes. "Contato aberto" registra tentativa, não avanço |
| **Inferência de fases** | Chegar a uma fase implica ter passado pelas anteriores, mesmo que o Pipefy não tenha registrado a transição. Elimina conversões acima de 100% |
| **…exceto etapas não instrumentadas** | O pipe antigo não tinha "Contato aberto" nem "Precificação". Inferir passagem por elas fabricaria um número plausível; elas ficam fora do cálculo (não só da tela) |
| **Tudo segue o seletor de período** (inclusive quantidade por fase) | Um seletor que comanda metade dos números é pior que nenhum. Custo assumido: a tela não bate com o board do Pipefy |
| **Coorte por data de criação** | O comparador de funil compara safras: "a safra de julho converteu melhor que a de junho?" |
| **Janela equalizada no comparador** | Com um período ainda em andamento, os dois lados são truncados no mesmo número de dias ou meses decorridos; com os dois fechados, usa cada um inteiro |
| **Datas em horário de Brasília** | A Vercel roda em UTC; sem âncora fixa, um registro do último dia do mês às 22 h cairia no mês seguinte |
| **Meta por nível, sem fallback** | Usar a meta da gestão quando faltava a do mês comparava as vendas de um mês com a meta do ano inteiro (atingimento de 4%) |
| **Meta de coordenação de 24/25 derivada dos ciclos** | Aquela gestão não cadastrou a meta anual por coordenação; a origem fica marcada como derivada |
| **Cross-sell conta em cada coordenação** | O projeto é de todas elas; por isso a soma das coordenações pode passar do total |

## Períodos fechados

| Decisão | Por quê |
|---|---|
| **Snapshot append-only, garantido pelo banco** | Corrigir a planilha em 2027 mudaria em silêncio um número já apresentado. O gatilho recusa UPDATE; convenção no código não bastaria |
| **Carência de 1 mês calendário** | Contrato assinado no fim do mês entra na planilha depois. Mês calendário em vez de "30 dias" para a regra caber numa frase |
| **Só vendas são congeladas** | Funil e LTV descrevem o board de agora; congelá-los mostraria um funil antigo como se fosse atual |
| **`VERSAO_CALCULO`** | Com a mesma versão, recalcular tem de dar igual; diferir é bug ou fonte alterada. Entre versões diferentes, diferir é esperado |
| **Congelamento manual** | Decisão consciente de quando o banco passa a ter dado autoral. Procedimento em [operacao.md](operacao.md#congelar-períodos-fechados) |

## Interface

| Decisão | Por quê |
|---|---|
| **Governança de cores em três papéis** (`src/lib/colors.ts`) | **Identidade** (marca: laranja `#F58332`, preto, branco; coordenações: CCE rosa `#FF1FA9`, ACE amarelo `#FDDD0F`, MNP vermelho `#ED212F`, QAB verde `#03CC4F`, PRO roxo `#76348D`), **alerta** (verde/amarelo/vermelho, só onde há referência objetiva: meta ou período comparado) e **volume** (tons de laranja, sem juízo de valor, usados no funil). As cores de alerta colidem com as de coordenação, por isso nunca se misturam |
| **Funil sem semáforo** | Conversão não tem "bom" ou "ruim" universal |
| **"Vendas", nunca "faturamento"** | Nada no dashboard mede faturamento |
| **Exportar imagem capturando a tela** (`html-to-image`) | Gerar a imagem no servidor seria um segundo renderizador, que divergiria do que a tela mostra |
| **Legenda só na imagem exportada** | Fora da tela, a imagem perde a barra lateral e o cabeçalho; coordenação e idade do dado precisam viajar junto |
| **Tema claro por padrão, alternável** | Decisão de UX da reformulação visual |

## Peculiaridades do código

- **Next.js 16 é diferente.** Convenções mudaram em relação às versões que a
  maioria das pessoas (e das IAs) conhece. Consulte `node_modules/next/dist/docs/`.
- **Comentários longos no topo dos arquivos** são intencionais: registram o erro
  que motivou cada decisão. Ao mudar o comportamento, atualize o comentário.
- **Seis `eslint-disable` justificados** (`react-hooks/set-state-in-effect` e
  `react-hooks/purity`) marcam busca de dados em `useEffect`. A correção de
  verdade é adotar uma biblioteca de data fetching (SWR, React Query).
- **`any` só em `scripts/`**, por regra no `eslint.config.mjs`: os scripts leem
  JSON sem esquema e rodam à mão.
