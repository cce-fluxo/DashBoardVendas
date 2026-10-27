// src/lib/fontes/registry.ts
//
// Onde cada gestão declara as suas fontes e o seu calendário.
//
// Adicionar a gestão 26/27 deve ser uma entrada aqui, não código novo.
//
// TUDO NESTE ARQUIVO FOI VERIFICADO CONTRA AS PLANILHAS REAIS em 01/08/2026 com
// `npx tsx scripts/inspecionar-planilha.ts`. Nada é suposição.
//
// Os spreadsheetId ficam no código de propósito: são identificadores, não
// segredos — o acesso é controlado pelo compartilhamento com a service account
// (GOOGLE_SERVICE_ACCOUNT_EMAIL). Só as credenciais vivem em .env.local.
//
// ─── Por que os ciclos são dados curados aqui, e não lidos da planilha ───
//
// Os ciclos existem na aba "Metas por coordenação", em blocos com o nome e a
// data `FIM:`. Poderiam ser lidos a cada sync — mas não devem:
//   1. São um fato pequeno, estável e decidido uma vez por gestão.
//   2. A fonte tem erro: "Ciclo Andes" (23/24) registra FIM em 30/05/2024, e
//      maio tem 31 dias. Lido ao pé da letra, 31/05/2024 não cairia em ciclo
//      nenhum. Aqui o intervalo é declarado por MÊS, o que torna o buraco
//      impossível de representar.
//   3. Curado, o calendário passa por `validarCalendario` no boot; lido da
//      planilha, um erro de digitação vira dado errado silencioso.

import type { Ciclo, FonteEntregas, Gestao, IdGestao } from "./tipos";

// ─── Colunas de contratos ─────────────────────────────────────────
//
// A coluna do mês é a ÚNICA exceção sancionada ao casamento por nome: ela não
// tem cabeçalho utilizável em nenhuma das três planilhas — vazio em 23/24 e
// 24/25, e o placeholder "Coluna 1" em 25/26, que não nomeia coisa alguma.
const COLUNA_MES = {
	tipo: "posicao",
	indice: 0,
	motivo:
		"Coluna A não tem cabeçalho em 23/24 e 24/25; em 25/26 é o placeholder 'Coluna 1'. Nenhum nome estável para casar.",
} as const;

// Regra do dono do processo: nome identifica o contrato, mês o coloca num
// período, e sem coordenação não dá para afirmar que o projeto aconteceu.
// As colunas de VALOR ficam FORA: contrato assinado sem valor preenchido é
// contrato — entra com zero, e o zero é visível.
const OBRIGATORIOS = ["mes", "projeto", "coordenacao"] as const;

// ─── Calendários ──────────────────────────────────────────────────
//
// 23/24 e 24/25: 3 ciclos de 4 meses. 25/26 e 26/27: 4 ciclos de 3 meses.
// As datas FIM vieram dos blocos de ciclo da aba "Metas por coordenação".

const CICLOS_2324: Ciclo[] = [
	{ id: "fuji", rotulo: "Ciclo Fuji", mesInicio: "10", mesFim: "01" },
	{ id: "andes", rotulo: "Ciclo Andes", mesInicio: "02", mesFim: "05" },
	{ id: "everest", rotulo: "Ciclo Everest", mesInicio: "06", mesFim: "09" },
];

const CICLOS_2425: Ciclo[] = [
	{ id: "waterloo", rotulo: "Ciclo Waterloo", mesInicio: "10", mesFim: "01" },
	{ id: "stalingrado", rotulo: "Ciclo Stalingrado", mesInicio: "02", mesFim: "05" },
	{ id: "normandia", rotulo: "Ciclo Normandia", mesInicio: "06", mesFim: "09" },
];

const CICLOS_2526: Ciclo[] = [
	{ id: "fogo", rotulo: "Ciclo Revolução do Fogo", mesInicio: "10", mesFim: "12" },
	{ id: "forja", rotulo: "Ciclo Revolução da Forja", mesInicio: "01", mesFim: "03" },
	{ id: "era-industrial", rotulo: "Ciclo Era Industrial", mesInicio: "04", mesFim: "06" },
	{ id: "apollo", rotulo: "Ciclo Apollo", mesInicio: "07", mesFim: "09" },
];

// Em 21/10/2026 só o primeiro ciclo tinha nome; os outros três aparecem na
// planilha como "Ciclo 2", "Ciclo 3" e "Ciclo 4". O `id` é a chave de
// `meta.periodo`: ao trocar um id provisório pelo nome real, a próxima carga
// regrava as metas com o id novo e remove as antigas. Isso só é seguro enquanto
// o ciclo não foi congelado — o snapshot guarda o id da época.
const CICLOS_2627: Ciclo[] = [
	{ id: "gambito", rotulo: "Ciclo Gambito", mesInicio: "10", mesFim: "12" },
	{ id: "ciclo-2", rotulo: "Ciclo 2", mesInicio: "01", mesFim: "03", rotuloProvisorio: true },
	{ id: "ciclo-3", rotulo: "Ciclo 3", mesInicio: "04", mesFim: "06", rotuloProvisorio: true },
	{ id: "ciclo-4", rotulo: "Ciclo 4", mesInicio: "07", mesFim: "09", rotuloProvisorio: true },
];

// ─── Gestões ──────────────────────────────────────────────────────

const PLANILHA_2324 = "13Nav6YnYqkcGT4TOCXSyYHr6ZcY0Rbt6XTBuzi81v6c";
const PLANILHA_2425 = "1IZbwYwyRhCY7ne8W_plGzLidT0pwuLbUXUMY3c7hZBg";
const PLANILHA_2526 = "1ssBeBDwghhiQU92-Hl9nkFt4QZ0dRK1wbkrJ6gick4E";
const PLANILHA_2627 = "1WKWznpWgS2VDKCaLHiBUjfZfJsFnYxR-8_92EC7O9B8";
/** "Fluxo Faturado por Mês 26/27": consolida as planilhas de faturamento das coordenações. */
const FATURAMENTO_2627 = "1VhcOqq1GKvwf3xEPUBTJsN_OjSwhcUy9raf9BceLQ-E";

/**
 * Planilha de projetos ("DPlanilha 25/26"). Apesar do nome, as abas abaixo
 * cobrem todas as gestões — a de cada projeto está nas colunas "Gestão - Venda"
 * e "Gestão - Entrega". Não é por gestão, então fica fora de GESTOES.
 */
export const FONTE_ENTREGAS: FonteEntregas = {
	spreadsheetId: "1F2kgDW-Q6vXqJM50WVFhzRly1iduw37Do1grD-YFPW8",
	abaEntregues: "Projetos - Entregues",
	abaEmExecucao: "Projetos - Atual",
};

export const GESTOES: Gestao[] = [
	{
		id: "23/24",
		anoInicio: 2023,
		ciclos: CICLOS_2324,
		contratos: {
			estrategia: "tabela",
			spreadsheetId: PLANILHA_2324,
			aba: "Contratos",
			linhaCabecalho: 1,
			colunas: {
				mes: COLUNA_MES,
				projeto: { tipo: "cabecalho", nome: "Projetos Assinados" },
				responsavel1: { tipo: "cabecalho", nome: "Responsável 1" },
				responsavel2: { tipo: "cabecalho", nome: "Responsável 2" },
				responsavel3: { tipo: "cabecalho", nome: "Responsável 3" },
				responsavel4: { tipo: "cabecalho", nome: "Responsável 4" },
				assinado: { tipo: "cabecalho", nome: "Assinado" },
				coordenacao: { tipo: "cabecalho", nome: "Coordenação" },
				itemDaCarta: { tipo: "cabecalho", nome: "Item da Carta" },
				prazo: { tipo: "cabecalho", nome: "Prazo" },
				valorVendidoReal: { tipo: "cabecalho", nome: "Valor Vendido real" },
				dataAssinatura: {
					tipo: "cabecalho",
					nome: "Data de Assinatura de contrato",
				},
				valorContrato: { tipo: "cabecalho", nome: "Valor contrato" },
				precoPorSemana: { tipo: "cabecalho", nome: "Preço por Semana" },
				// "Nº" com indicador ordinal; as outras gestões usam "N°" com sinal
				// de grau. normalizarCabecalho() unifica os dois.
				numeroParcelas: { tipo: "cabecalho", nome: "Nº Parcelas" },
				canalAquisicao: { tipo: "cabecalho", nome: "Canal de aquisição" },
				compiladoNoPortal: { tipo: "cabecalho", nome: "Compilado no Portal" },
				// Sem "Contratante", sem data de entrega e sem "Fidelização?".
			},
			obrigatorios: [...OBRIGATORIOS],
		},
		metas: {
			estrategia: "blocos",
			spreadsheetId: PLANILHA_2324,
			aba: "Metas por coordenação",
			colunaBlocosB: 1, // B
			colunaBlocosCiclo: 4, // E
			ancoraMensal: "METAS",
			ancoraFimMensal: "total",
			prefixoCiclo: "Ciclo",
		},
		observacoes: [
			"Não tem coluna 'Fidelização?': nesta gestão, fidelização é um VALOR de 'Canal de aquisição'. Comparar canal entre gestões sem tratar isso distorce os dois lados.",
			"Responsáveis são apelidos ('Fulano', 'Beltrano'), não nomes completos. Não é possível casar com as gestões seguintes — contam como vendedores distintos.",
			"A coluna 'Código Projeto' existe e está inteiramente vazia.",
			"Sem funil: o Pipefy antigo só começa em 18/12/2023, então out–dez/2023 não tem cobertura.",
		],
	},

	{
		id: "24/25",
		anoInicio: 2024,
		ciclos: CICLOS_2425,
		contratos: {
			estrategia: "tabela",
			spreadsheetId: PLANILHA_2425,
			aba: "Contratos",
			linhaCabecalho: 1,
			colunas: {
				mes: COLUNA_MES,
				projeto: { tipo: "cabecalho", nome: "Projetos Assinados" },
				responsavel1: { tipo: "cabecalho", nome: "Responsável 1" },
				responsavel2: { tipo: "cabecalho", nome: "Responsável 2" },
				responsavel3: { tipo: "cabecalho", nome: "Responsável 3" },
				responsavel4: { tipo: "cabecalho", nome: "Responsável 4" },
				assinado: { tipo: "cabecalho", nome: "Assinado" },
				coordenacao: { tipo: "cabecalho", nome: "Coordenação" },
				itemDaCarta: { tipo: "cabecalho", nome: "Item da Carta" },
				prazo: { tipo: "cabecalho", nome: "Prazo" },
				valorVendidoReal: { tipo: "cabecalho", nome: "Valor Vendido real" },
				dataAssinatura: {
					tipo: "cabecalho",
					nome: "Data de Assinatura de contrato",
				},
				// Mesmo conceito que 25/26 chama de "Data de Finalização (Estimativa)".
				dataEntrega: { tipo: "cabecalho", nome: "Data de entrega (estimativa)" },
				valorContrato: { tipo: "cabecalho", nome: "Valor contrato" },
				precoPorSemana: { tipo: "cabecalho", nome: "Preço por Semana" },
				numeroParcelas: { tipo: "cabecalho", nome: "N° Parcelas" },
				canalAquisicao: { tipo: "cabecalho", nome: "Canal de aquisição" },
				fidelizacao: { tipo: "cabecalho", nome: "Fidelização?" },
				compiladoNoPortal: { tipo: "cabecalho", nome: "Compilado no Portal" },
			},
			obrigatorios: [...OBRIGATORIOS],
		},
		metas: {
			estrategia: "blocos",
			spreadsheetId: PLANILHA_2425,
			aba: "Metas por coordenação",
			colunaBlocosB: 1, // B
			colunaBlocosCiclo: 4, // E
			ancoraMensal: "METAS",
			ancoraFimMensal: "total",
			prefixoCiclo: "Ciclo",
		},
		observacoes: [
			"Sem 'Contratante' (só 25/26 tem).",
			"Não cadastrou meta de coordenação no nível de gestão — usar a soma das metas de ciclo de cada coordenação. Erro pontual desta gestão.",
			"As abas de ciclo estão em ordem cronológica INVERTIDA (Normandia, Stalingrado, Waterloo).",
		],
	},

	{
		id: "25/26",
		anoInicio: 2025,
		ciclos: CICLOS_2526,
		contratos: {
			estrategia: "tabela",
			spreadsheetId: PLANILHA_2526,
			aba: "Contratos",
			linhaCabecalho: 1,
			colunas: {
				mes: COLUNA_MES,
				projeto: { tipo: "cabecalho", nome: "Projetos Assinados" },
				contratante: { tipo: "cabecalho", nome: "Contratante" },
				responsavel1: { tipo: "cabecalho", nome: "Responsável 1" },
				responsavel2: { tipo: "cabecalho", nome: "Responsável 2" },
				responsavel3: { tipo: "cabecalho", nome: "Responsável 3" },
				responsavel4: { tipo: "cabecalho", nome: "Responsável 4" },
				assinado: { tipo: "cabecalho", nome: "Assinado" },
				coordenacao: { tipo: "cabecalho", nome: "Coordenação" },
				itemDaCarta: { tipo: "cabecalho", nome: "Item da Carta" },
				prazo: { tipo: "cabecalho", nome: "Prazo" },
				valorVendidoReal: { tipo: "cabecalho", nome: "Valor Vendido real" },
				// O cabeçalho tem quebra de linha interna:
				// "Data de Finalização\n(Estimativa)". normalizarCabecalho() colapsa.
				dataEntrega: {
					tipo: "cabecalho",
					nome: "Data de Finalização (Estimativa)",
				},
				dataAssinatura: {
					tipo: "cabecalho",
					nome: "Data de Assinatura de contrato",
				},
				valorContrato: { tipo: "cabecalho", nome: "Valor contrato" },
				precoPorSemana: { tipo: "cabecalho", nome: "Preço por Semana" },
				numeroParcelas: { tipo: "cabecalho", nome: "N° Parcelas" },
				canalAquisicao: { tipo: "cabecalho", nome: "Canal de aquisição" },
				fidelizacao: { tipo: "cabecalho", nome: "Fidelização?" },
				compiladoNoPortal: { tipo: "cabecalho", nome: "Compilado no Portal" },
			},
			obrigatorios: [...OBRIGATORIOS],
		},
		metas: {
			estrategia: "blocos",
			spreadsheetId: PLANILHA_2526,
			aba: "Metas por coordenação",
			colunaBlocosB: 1, // B
			colunaBlocosCiclo: 4, // E
			ancoraMensal: "METAS",
			ancoraFimMensal: "total",
			ancoraGestao: "GESTÃO",
			prefixoCiclo: "Ciclo",
		},
		observacoes: [
			"Em 'Contratos', a ordem das duas colunas de data é invertida em relação a 24/25 (finalização antes de assinatura). O casamento por nome resolve.",
			"No bloco METAS da aba 'Metas por coordenação', os rótulos de mês estão DESATUALIZADOS ('outubro/2024'..'setembro/2025' numa planilha de 25/26). Os valores estão certos — a soma bate com a meta de gestão. Nunca derivar o ano do rótulo.",
		],
	},

	// Conferida em 21/10/2026 com `npx tsx scripts/inspecionar-planilha.ts`:
	// mesmos cabeçalhos de 'Contratos' e mesmo layout de blocos de 25/26.
	{
		id: "26/27",
		anoInicio: 2026,
		ciclos: CICLOS_2627,
		contratos: {
			estrategia: "tabela",
			spreadsheetId: PLANILHA_2627,
			aba: "Contratos",
			linhaCabecalho: 1,
			colunas: {
				mes: COLUNA_MES,
				projeto: { tipo: "cabecalho", nome: "Projetos Assinados" },
				contratante: { tipo: "cabecalho", nome: "Contratante" },
				responsavel1: { tipo: "cabecalho", nome: "Responsável 1" },
				responsavel2: { tipo: "cabecalho", nome: "Responsável 2" },
				responsavel3: { tipo: "cabecalho", nome: "Responsável 3" },
				responsavel4: { tipo: "cabecalho", nome: "Responsável 4" },
				assinado: { tipo: "cabecalho", nome: "Assinado" },
				coordenacao: { tipo: "cabecalho", nome: "Coordenação" },
				itemDaCarta: { tipo: "cabecalho", nome: "Item da Carta" },
				prazo: { tipo: "cabecalho", nome: "Prazo" },
				valorVendidoReal: { tipo: "cabecalho", nome: "Valor Vendido real" },
				dataEntrega: {
					tipo: "cabecalho",
					nome: "Data de Finalização (Estimativa)",
				},
				dataAssinatura: {
					tipo: "cabecalho",
					nome: "Data de Assinatura de contrato",
				},
				valorContrato: { tipo: "cabecalho", nome: "Valor contrato" },
				precoPorSemana: { tipo: "cabecalho", nome: "Preço por Semana" },
				numeroParcelas: { tipo: "cabecalho", nome: "N° Parcelas" },
				canalAquisicao: { tipo: "cabecalho", nome: "Canal de aquisição" },
				fidelizacao: { tipo: "cabecalho", nome: "Fidelização?" },
				compiladoNoPortal: { tipo: "cabecalho", nome: "Compilado no Portal" },
			},
			obrigatorios: [...OBRIGATORIOS],
		},
		metas: {
			estrategia: "blocos",
			spreadsheetId: PLANILHA_2627,
			aba: "Metas por coordenação",
			colunaBlocosB: 1, // B
			colunaBlocosCiclo: 4, // E
			ancoraMensal: "METAS",
			ancoraFimMensal: "total",
			ancoraGestao: "GESTÃO",
			prefixoCiclo: "Ciclo",
		},
		faturamento: {
			spreadsheetId: FATURAMENTO_2627,
			abas: [
				{ aba: "Visão Geral", coordenacao: null },
				{ aba: "ACE", coordenacao: "ACE" },
				{ aba: "CCE", coordenacao: "CCE" },
				{ aba: "MNP", coordenacao: "MNP" },
				{ aba: "PRO", coordenacao: "PRO" },
				{ aba: "QAB", coordenacao: "QAB" },
			],
			metas: {
				estrategia: "blocos",
				spreadsheetId: FATURAMENTO_2627,
				aba: "Metas por coordenação",
				colunaBlocosB: 1, // B
				colunaBlocosCiclo: 4, // E
				ancoraMensal: "METAS",
				ancoraFimMensal: "total",
				prefixoCiclo: "Ciclo",
			},
		},
		observacoes: [
			"Diferente de 25/26, os rótulos de mês do bloco METAS já estão no ano certo (outubro/2026..setembro/2027). A regra de não derivar o ano do rótulo continua valendo.",
			"Na planilha de faturamento, os blocos de ciclo se chamam 'Ciclo 1'..'Ciclo 4' e o 'total' do bloco mensal soma só os meses já definidos — por isso a meta de GESTÃO de faturamento não é gravada (ver sync-sheets.ts).",
			"A aba 'Metas por coordenação' tem, à direita (colunas K em diante), tabelas de gestões antigas (15/16 a 20/21). Ficam fora das colunas B e E e não são lidas.",
		],
	},
];

// ─── Acesso ───────────────────────────────────────────────────────

export function buscarGestao(id: IdGestao): Gestao {
	const g = GESTOES.find((x) => x.id === id);
	if (!g) {
		throw new Error(
			`Gestão "${id}" não está no registry. Conhecidas: ${GESTOES.map((x) => x.id).join(", ")}.`,
		);
	}
	return g;
}

export function idsDeGestao(): IdGestao[] {
	return GESTOES.map((g) => g.id);
}

/**
 * Gestão vigente na data informada. A gestão vai de 01/out a 30/set, então
 * meses 10–12 pertencem à gestão que começa naquele ano civil.
 *
 * Isto substitui a constante GESTAO_ATUAL: em 01/10/2026 o resultado vira
 * "26/27" sozinho, sem editar código.
 */
export function idGestaoVigente(hoje: Date = new Date()): IdGestao {
	// getMonth() é 0-based; usamos UTC para não depender do fuso do processo.
	const mes = hoje.getUTCMonth() + 1;
	const ano = hoje.getUTCFullYear();
	const anoInicio = mes >= 10 ? ano : ano - 1;
	const aa = String(anoInicio % 100).padStart(2, "0");
	const bb = String((anoInicio + 1) % 100).padStart(2, "0");
	return `${aa}/${bb}`;
}

/**
 * A gestão vigente — ou, se ela ainda não tem fonte cadastrada, a mais recente
 * que tem.
 *
 * A virada de 01/out acontece antes de a planilha nova existir: a gestão 26/27
 * começou sem planilha, e o time continuou a trabalhar na de 25/26. Exigir a
 * vigente à risca fazia o cron lançar erro (nenhuma planilha era sincronizada) e
 * toda tela e rota que partem do padrão quebrar, porque `buscarGestao` lança
 * para uma gestão fora do registry.
 *
 * Quem usa o fallback deve DIZER que ele aconteceu: compare o `id` devolvido com
 * `idGestaoVigente` (o cron faz isso e põe um aviso na resposta).
 */
function gestaoComFonte(hoje: Date, gestoes: Gestao[]): Gestao | undefined {
	const vigente = idGestaoVigente(hoje);
	return (
		gestoes.find((g) => g.id === vigente) ??
		[...gestoes].sort((a, b) => b.anoInicio - a.anoInicio)[0]
	);
}

/** Gestão que as TELAS e a API usam quando ninguém escolheu uma. */
export function gestaoPadraoDaTela(
	hoje: Date = new Date(),
	gestoes: Gestao[] = GESTOES,
): IdGestao {
	return gestaoComFonte(hoje, gestoes)?.id ?? idGestaoVigente(hoje);
}

/**
 * Escopo do cron: só a gestão vigente. Gestões encerradas não mudam, então
 * reprocessá-las a cada rodada é desperdício e multiplica o risco de estourar a
 * cota do Sheets.
 *
 * Enquanto a vigente não tem fonte, usa a mais recente cadastrada (ver
 * `gestaoComFonte`). Só LANÇA se o registry estiver vazio — nunca devolve lista
 * vazia, porque sincronizar zero em silêncio é o modo de falha que este projeto
 * inteiro existe para eliminar.
 */
export function gestoesDoCron(hoje: Date = new Date()): Gestao[] {
	const g = gestaoComFonte(hoje, GESTOES);
	if (!g) {
		throw new Error(
			`O registry de gestões está vazio. Cadastre as fontes em src/lib/fontes/registry.ts.`,
		);
	}
	return [g];
}
