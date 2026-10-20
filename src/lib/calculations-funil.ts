// src/lib/calculations-funil.ts
//
// SEPARAÇÃO DE CONCEITOS — leia antes de alterar:
//
//   QUANTIDADE por fase  →  cards do PERÍODO SELECIONADO que estão hoje na fase X.
//     Responde "das oportunidades nascidas neste período, onde elas estão agora?".
//
//   PERCENTUAL DE CONVERSÃO  →  dos cards do período, quantos passaram por cada
//     fase, sobre a base Oportunidade. Só funil comercial.
//     Responde "quão eficiente foi o funil desta safra?".
//
//   TEMPO DE FUNIL  →  idem, restrito aos cards do período.
//
// TUDO SEGUE O SELETOR DE PERÍODO. A única exceção no dashboard é o Comparador
// periódico de funil, que por definição escolhe DOIS períodos próprios.
//
// ANTES ERA DIFERENTE, e vale saber por quê. A quantidade ignorava data: contava
// todos os cards na fase X, de qualquer época, para bater com o número que o
// Pipefy mostra no board. A intenção era boa e o efeito era ruim — trocar o
// período mudava os percentuais e não mexia nas quantidades, então a mesma tela
// respondia a duas perguntas ao mesmo tempo sem dizer qual era qual. Um seletor
// que comanda metade dos números é pior que nenhum: ele parece comandar tudo.
//
// O custo, assumido: as contagens deixam de bater com o board do Pipefy, porque
// o board mostra card antigo ainda aberto e esta tela mostra a safra escolhida.
// São perguntas diferentes, e a tela agora responde só uma.

import { Coordenacao, EtapaFunil } from "@/types";
import { COORDENACOES } from "@/lib/coordenacoes";
import { CardComHistorico } from "@/lib/supabase-funil";
import {
	EtapaConversao,
	EtapaTempo,
	KPIsFunilConversao,
	KPIsFunilTempo,
	KPIsFunilCompleto,
	KPIsEntradaDireta,
	ComparadorFasesResultado,
	SelecaoPeriodoFunil,
	FunilVolume,
	FunilPeriodo,
	DeltaEtapaFunil,
	ComparativoFunilPeriodos,
	JanelaEqualizada,
	MaturidadeCoorte,
} from "@/types";
import {
	janelaPeriodo,
	diasEntre,
	gestaoAtual,
	JanelaPeriodo,
} from "./periodo-gestao";
import { buscarPipe } from "./fontes/pipes";
import { avisoDeLacunaFunil } from "./fontes/cobertura";

// ─── Constantes ───────────────────────────────────────────────────

const ORDEM_ETAPAS: EtapaFunil[] = [
	"Oportunidade",
	"Contato aberto",
	"Pré-diagnóstico feito",
	"Diagnóstico feito",
	"Precificação/Aprovação em andamento",
	"Proposta comercial feita",
	"Follow-up",
	"Venda",
];

const ETAPAS_FECHAMENTO: ReadonlySet<string> = new Set([
	"Venda",
	"Perdido",
	"Pausado",
]);

// Excluídas do cálculo de tempo por fase:
//   Oportunidade → pré-funil
//   Venda        → terminal positivo
const ETAPAS_FORA_TEMPO_POR_FASE: ReadonlySet<string> = new Set([
	"Oportunidade",
	"Venda",
]);

/**
 * Base 100% do funil.
 *
 * Era "Contato aberto". Trocou por duas razões:
 *
 *   1. Pela definição do processo, "Contato aberto" registra TENTATIVA de
 *      contato, não avanço — um denominador que varia com a disciplina de quem
 *      mexe no card, não com o funil.
 *   2. A fase não existe no pipe antigo. Todo card passa por "Oportunidade", nos
 *      dois pipes, o que torna a comparação entre gestões possível sem nota de
 *      rodapé.
 */
const ETAPA_BASE: EtapaFunil = "Oportunidade";

// Lista canônica — ver src/lib/coordenacoes.ts.

// ─── Filtro de janela de gestão ───────────────────────────────────

/**
 * Cards criados dentro do período selecionado.
 *
 * Recebe a SELEÇÃO inteira, não só a gestão: era a gestão que fazia ciclo e mês
 * serem ignorados por tudo que não fosse o comparador.
 */
export function filtrarCardsPorPeriodo(
	cards: CardComHistorico[],
	sel: SelecaoPeriodoFunil,
): CardComHistorico[] {
	const { inicio, fim } = janelaPeriodo(sel);
	return cards.filter((c) => {
		if (!c.data_criacao) return false;
		const d = new Date(c.data_criacao);
		return !isNaN(d.getTime()) && d >= inicio && d <= fim;
	});
}

/**
 * Mantém só os cards de alguma das coordenações escolhidas.
 *
 * Card de cross-sell pertence a mais de uma: entra se QUALQUER uma estiver
 * selecionada, e entra UMA vez. É por isso que este corte precisa acontecer
 * antes do cálculo — somar os funis por coordenação no cliente contaria o
 * cross-sell duas vezes, e percentual de conversão não se soma de jeito nenhum.
 */
export function filtrarCardsPorCoordenacoes(
	cards: CardComHistorico[],
	coordenacoes: Coordenacao[],
): CardComHistorico[] {
	if (coordenacoes.length === 0) return cards;
	const alvo = new Set(coordenacoes);
	return cards.filter((c) => c.coordenacoes.some((x) => alvo.has(x as Coordenacao)));
}

/** Seleção padrão: a gestão vigente inteira. */
export function periodoPadrao(): SelecaoPeriodoFunil {
	return { gestao: gestaoAtual(), tipo: "gestao" };
}

// ─── Utilitários ──────────────────────────────────────────────────

// Filtra cards onde a coordenação aparece no array cru — inclui cross-sell.
// Card ["PRO","ACE"] aparece em PRO e em ACE.
// Card ["N1"] não aparece em nenhuma das 5 coordenações padrão.
function filtrarPorCoordenacao(
	cards: CardComHistorico[],
	coord: Coordenacao,
): CardComHistorico[] {
	return cards.filter((c) => c.coordenacoes.includes(coord));
}

// Funil comercial: histórico começa em "Oportunidade".
function ehFunilComercial(card: CardComHistorico): boolean {
	return (
		card.historico.length > 0 && card.historico[0].etapa === "Oportunidade"
	);
}

// Índice da fase comercial mais avançada que o card alcançou em ORDEM_ETAPAS.
// INFERÊNCIA DE FASES INTERMEDIÁRIAS (decisão de produto): chegar a uma fase
// implica ter passado por todas as anteriores — mesmo que o Pipefy não tenha
// gravado a transição (firstTimeIn nulo é filtrado na ingestão). Isso elimina
// percentuais > 100% e fases que "sumiam" por histórico incompleto.
// Terminais (Perdido/Pausado) não estão em ORDEM_ETAPAS → não avançam a escada;
// o que conta é a fase comercial mais avançada antes do fechamento.
// Retorna -1 se o card não passou por nenhuma fase comercial.
//
// observarAte (opcional): congela o histórico nesse instante — transições
// posteriores são ignoradas. É o que permite reconstruir o funil "como estava"
// numa data (coorte fechada / janela equalizada). Sem o parâmetro, considera
// todo o histórico (comportamento padrão do funil em tempo real).
function indiceFaseMaisAvancada(
	card: CardComHistorico,
	observarAte?: Date,
): number {
	let max = -1;
	const corte = observarAte?.getTime();
	for (const h of card.historico) {
		if (corte !== undefined && new Date(h.timestamp).getTime() > corte) continue;
		const idx = (ORDEM_ETAPAS as string[]).indexOf(h.etapa);
		if (idx > max) max = idx;
	}
	return max;
}

// Timestamp do evento de fechamento, ou null se card ainda ativo.
function timestampFechamento(card: CardComHistorico): Date | null {
	if (!ETAPAS_FECHAMENTO.has(card.etapa_atual)) return null;
	const eventos = card.historico.filter((h) => h.etapa === card.etapa_atual);
	if (eventos.length === 0) return null;
	return new Date(eventos[eventos.length - 1].timestamp);
}

// Saída de uma fase para cálculo de tempo.
function saidaDaFase(
	card: CardComHistorico,
	indexTransicao: number,
	agora: Date,
): Date {
	const proxima = card.historico[indexTransicao + 1];
	if (proxima) return new Date(proxima.timestamp);
	return timestampFechamento(card) ?? agora;
}

function mediaDias(arr: number[]): number {
	return arr.length > 0
		? Math.round(arr.reduce((s, t) => s + t, 0) / arr.length)
		: 0;
}

// ─── Conversão ────────────────────────────────────────────────────
//
// cardsDoPeriodo → todos os cards criados no período (para QUANTIDADE).
//                  Inclui entrada direta: quantidade é ESTADO, não trajetória.
// comerciais     → os do período que entraram pelo funil (para PERCENTUAL).
//
// Os dois já vêm recortados pelo mesmo período. Antes o primeiro vinha sem
// filtro nenhum, e era isso que fazia a quantidade ignorar o seletor.

function calcularConversao(
	cardsDoPeriodo: CardComHistorico[],
	comerciais: CardComHistorico[],
): KPIsFunilConversao {
	const baseIdx = (ORDEM_ETAPAS as string[]).indexOf(ETAPA_BASE);
	const naoInstrumentadas = etapasNaoInstrumentadasDe(comerciais);

	// Percentuais: usam a fase mais avançada alcançada por cada card (com inferência
	// de intermediárias — ver indiceFaseMaisAvancada).
	const faseMaisAvancada = comerciais.map((c) => indiceFaseMaisAvancada(c));

	// Quantos cards alcançaram pelo menos a fase de índice i.
	const alcancaram = (i: number) =>
		faseMaisAvancada.filter((f) => f >= i).length;

	const totalBase = alcancaram(baseIdx);

	// Índices das etapas que PODEM ter percentual. A etapa-a-etapa compara com a
	// instrumentada anterior, pulando os buracos — comparar com uma fase que não
	// existia daria 100% sempre.
	const instrumentadas = ORDEM_ETAPAS.map((e, i) => ({ e, i })).filter(
		({ e }) => !naoInstrumentadas.has(e),
	);

	const etapas: EtapaConversao[] = ORDEM_ETAPAS.map((etapa, i) => {
		// QUANTIDADE: cards DO PERÍODO que estão hoje nesta fase. Inclui entrada
		// direta, porque a pergunta aqui é "onde eles estão", não "por onde vieram".
		const quantidade = cardsDoPeriodo.filter(
			(c) => c.etapa_atual === etapa,
		).length;

		// NÃO INSTRUMENTADA: a fase não existia no pipe de origem destes cards.
		// Sem percentual — e é por isso que o corte precisa acontecer AQUI, não na
		// UI: `alcancaram` infere que chegar à fase N implica ter passado pelas
		// anteriores, então um card do pipe antigo que chegou em "Diagnóstico"
		// seria contado como tendo passado por "Contato aberto", fase que nunca
		// existiu ali. O número sairia plausível e falso.
		if (naoInstrumentadas.has(etapa)) {
			return { etapa, quantidade, naoInstrumentada: true };
		}

		const alcancaramI = alcancaram(i);

		// ACUMULADA: relativa à base (100%). Monotônica, nunca > 100%.
		const percentualRelativo =
			totalBase > 0 ? (alcancaramI / totalBase) * 100 : 0;

		// ETAPA-A-ETAPA: relativa à etapa instrumentada imediatamente anterior.
		let percentualEtapaAnterior: number | undefined;
		let baseEtapaAnterior: EtapaFunil | undefined;
		const posicao = instrumentadas.findIndex((x) => x.e === etapa);
		if (posicao > 0) {
			const anterior = instrumentadas[posicao - 1];
			baseEtapaAnterior = anterior.e;
			const alcancaramAnterior = alcancaram(anterior.i);
			percentualEtapaAnterior =
				alcancaramAnterior > 0 ? (alcancaramI / alcancaramAnterior) * 100 : 0;
		}

		return {
			etapa,
			quantidade,
			percentualRelativo,
			percentualEtapaAnterior,
			baseEtapaAnterior,
		};
	});

	return { etapas, totalBase };
}

/**
 * Etapas que NÃO foram medidas para este conjunto de cards.
 *
 * Regra conservadora: basta UM pipe presente não instrumentar a etapa para ela
 * inteira ficar sem percentual. Num período que atravessa a troca de pipe, o
 * denominador misturaria "não passou" com "não podia passar" — número que
 * parece medido e não é.
 */
function etapasNaoInstrumentadasDe(
	cards: CardComHistorico[],
): Set<EtapaFunil> {
	const fora = new Set<EtapaFunil>();
	const pipesVistos = new Set(
		cards.map((c) => c.pipe_id).filter((p): p is string => Boolean(p)),
	);

	for (const pipeId of pipesVistos) {
		let mapa;
		try {
			mapa = buscarPipe(pipeId);
		} catch {
			// Pipe desconhecido: não dá para afirmar o que ele instrumenta, então
			// não se afirma nada. A auditoria acusa o pipe_id órfão.
			continue;
		}
		for (const e of mapa.etapasNaoInstrumentadas) fora.add(e as EtapaFunil);
	}

	return fora;
}

/**
 * Média de horas por etapa, marcando as que o pipe de origem não instrumentava.
 *
 * Existia em duas cópias idênticas — e foi essa duplicação que deixou o corte de
 * etapa não instrumentada entrar só na conversão do funil geral e não na do
 * comparador. Uma definição só.
 *
 * Fase ausente devolve `tempoMedioHoras: 0` COM a marca: "0 horas" na tela lê-se
 * como instantâneo, que é o oposto de "ninguém mediu".
 */
function montarEtapasTempo(
	temposPorEtapa: Partial<Record<EtapaFunil, number[]>>,
	comerciais: CardComHistorico[],
): EtapaTempo[] {
	const naoInstrumentadas = etapasNaoInstrumentadasDe(comerciais);

	return ORDEM_ETAPAS.map((etapa) => {
		if (naoInstrumentadas.has(etapa))
			return { etapa, tempoMedioHoras: 0, naoInstrumentada: true };

		const tempos = temposPorEtapa[etapa] ?? [];
		const tempoMedioHoras =
			tempos.length > 0
				? Math.round((tempos.reduce((s, t) => s + t, 0) / tempos.length) * 10) /
					10
				: 0;
		return { etapa, tempoMedioHoras };
	});
}

// ─── Tempo ────────────────────────────────────────────────────────
// Usa apenas cards da janela de gestão.

function calcularTempo(cardsNaJanela: CardComHistorico[]): KPIsFunilTempo {
	const agora = new Date();
	const temposPorEtapa: Partial<Record<EtapaFunil, number[]>> = {};
	const diasAteVenda: number[] = [];
	const diasAteFechamento: number[] = [];

	cardsNaJanela.forEach((card) => {
		const lista = card.historico;
		if (lista.length === 0) return;

		const entradaNoFunil = new Date(lista[0].timestamp);
		const fechamento = timestampFechamento(card);

		if (card.etapa_atual === "Venda" && fechamento) {
			const dias =
				(fechamento.getTime() - entradaNoFunil.getTime()) /
				(1000 * 60 * 60 * 24);
			if (dias >= 0) diasAteVenda.push(dias);
		}

		if (fechamento) {
			const dias =
				(fechamento.getTime() - entradaNoFunil.getTime()) /
				(1000 * 60 * 60 * 24);
			if (dias >= 0) diasAteFechamento.push(dias);
		}

		lista.forEach((transicao, index) => {
			const etapa = transicao.etapa;
			if (!(ORDEM_ETAPAS as string[]).includes(etapa)) return;
			if (ETAPAS_FORA_TEMPO_POR_FASE.has(etapa)) return;

			const entradaEtapa = new Date(transicao.timestamp);
			const saida = saidaDaFase(card, index, agora);
			const horas =
				(saida.getTime() - entradaEtapa.getTime()) / (1000 * 60 * 60);

			const etapaFunil = etapa as EtapaFunil;
			if (!temposPorEtapa[etapaFunil]) temposPorEtapa[etapaFunil] = [];
			temposPorEtapa[etapaFunil]!.push(horas);
		});
	});

	const etapas = montarEtapasTempo(temposPorEtapa, cardsNaJanela);

	return {
		etapas,
		tempoMedioVendaDias: mediaDias(diasAteVenda),
		tempoMedioFechamentoDias: mediaDias(diasAteFechamento),
		totalVendas: diasAteVenda.length,
	};
}

// ─── Função principal ─────────────────────────────────────────────

export function calcularKPIsFunilCompleto(
	cards: CardComHistorico[],
	sel: SelecaoPeriodoFunil = periodoPadrao(),
): KPIsFunilCompleto {
	// UM recorte só, usado por quantidade, percentual e tempo. Antes a quantidade
	// vinha de `cards` inteiro e o resto da janela da gestão — dois universos na
	// mesma tela.
	const doPeriodo = filtrarCardsPorPeriodo(cards, sel);
	const comerciais = doPeriodo.filter(ehFunilComercial);

	const geral = {
		conversao: calcularConversao(doPeriodo, comerciais),
		tempo: calcularTempo(comerciais),
	};

	// ── Por coordenação ───────────────────────────────────────────
	const porCoordenacao: Partial<KPIsFunilCompleto["porCoordenacao"]> = {};

	COORDENACOES.forEach((coord) => {
		porCoordenacao[coord] = {
			conversao: calcularConversao(
				filtrarPorCoordenacao(doPeriodo, coord),
				filtrarPorCoordenacao(comerciais, coord),
			),
			tempo: calcularTempo(filtrarPorCoordenacao(comerciais, coord)),
		};
	});

	return {
		geral,
		porCoordenacao: porCoordenacao as KPIsFunilCompleto["porCoordenacao"],
	};
}

// ─── Entrada Direta ──────────────────────────────────────────────

export function calcularEntradaDireta(
	cards: CardComHistorico[],
	sel: SelecaoPeriodoFunil = periodoPadrao(),
): KPIsEntradaDireta {
	const cardsEntradaDireta = filtrarCardsPorPeriodo(cards, sel).filter(
		(c) => !ehFunilComercial(c),
	);

	const porCoordenacao: Partial<KPIsEntradaDireta["porCoordenacao"]> = {};
	let totalQuantidade = 0;
	let totalValor = 0;

	COORDENACOES.forEach((coord) => {
		const cardsCoord = filtrarPorCoordenacao(cardsEntradaDireta, coord);
		const quantidade = cardsCoord.length;
		const valorTotal = cardsCoord.reduce(
			(acc, c) => acc + (c.valor_contrato ?? 0),
			0,
		);
		porCoordenacao[coord] = { quantidade, valorTotal };
		totalQuantidade += quantidade;
		totalValor += valorTotal;
	});

	return {
		porCoordenacao: porCoordenacao as KPIsEntradaDireta["porCoordenacao"],
		totalGeral: { quantidade: totalQuantidade, valorTotal: totalValor },
	};
}

// ─── Comparador de fases ─────────────────────────────────────────

export function calcularComparadorFases(
	cards: CardComHistorico[],
	etapaDe: EtapaFunil,
	etapaPara: EtapaFunil,
	sel: SelecaoPeriodoFunil = periodoPadrao(),
): ComparadorFasesResultado {
	// Segue o seletor, como o resto da tela. Aplica a mesma inferência de fases
	// intermediárias do funil de conversão (consistência + evita % > 100%).
	const cardsFunilComercial = filtrarCardsPorPeriodo(cards, sel).filter(
		ehFunilComercial,
	);
	const faseMaisAvancada = cardsFunilComercial.map((c) =>
		indiceFaseMaisAvancada(c),
	);

	const deIdx = (ORDEM_ETAPAS as string[]).indexOf(etapaDe);
	const paraIdx = (ORDEM_ETAPAS as string[]).indexOf(etapaPara);

	// Se uma das pontas não existia no pipe destes cards, não há conversão a
	// medir — `indiceFaseMaisAvancada` INFERE as intermediárias, então a conta
	// sairia (e sairia errada, provavelmente 100%).
	//
	// Hoje isto não é alcançável: a rota não recebe gestão e a atual só tem o
	// pipe novo. Fica aqui porque o dia em que alguém adicionar o parâmetro de
	// período — e vai adicionar — o número falso volta sozinho, sem ninguém
	// tocar nesta função.
	const naoInstrumentadas = etapasNaoInstrumentadasDe(cardsFunilComercial);
	const semMedicao = [etapaDe, etapaPara].filter((e) =>
		naoInstrumentadas.has(e),
	);
	if (semMedicao.length > 0) {
		return {
			etapaDe,
			etapaPara,
			totalNaEtapaDe: 0,
			chegaramNaEtapaPara: 0,
			percentual: 0,
			naoInstrumentadas: semMedicao,
		};
	}

	const totalNaEtapaDe = faseMaisAvancada.filter((f) => f >= deIdx).length;
	const chegaramNaEtapaPara = faseMaisAvancada.filter(
		(f) => f >= paraIdx,
	).length;

	const percentual =
		totalNaEtapaDe > 0 ? (chegaramNaEtapaPara / totalNaEtapaDe) * 100 : 0;

	return {
		etapaDe,
		etapaPara,
		totalNaEtapaDe,
		chegaramNaEtapaPara,
		percentual,
	};
}

// ─── Comparador periódico de funil (F1) ──────────────────────────
//
// SEMÂNTICA (coorte fechada): mede o funil dos cards CRIADOS dentro de uma
// janela de datas, usando o histórico congelado em `observarAte`. Diferente do
// funil em tempo real, a QUANTIDADE por fase aqui é "quantos da coorte
// alcançaram a fase" (monotônica), não a contagem atual do Pipefy — porque o
// objetivo é comparar safras, não refletir o board.
//
// Limiar (em dias) abaixo do qual uma coorte já fechada é considerada "em
// maturação": ainda não teve tempo de percorrer o funil até o fim.
const LIMIAR_MATURACAO_DIAS = 90;

const DIA_MS = 1000 * 60 * 60 * 24;

interface JanelaFunil {
	criadoDe: Date;
	criadoAte: Date;
	observarAte: Date;
}

// Histórico visível até o corte (ordenado asc; o array de origem já vem ordenado).
function historicoAte(
	card: CardComHistorico,
	observarAte: Date,
): CardComHistorico["historico"] {
	const corte = observarAte.getTime();
	return card.historico.filter((h) => new Date(h.timestamp).getTime() <= corte);
}

// Fechamento como visto na janela: a coorte está fechada se a última transição
// visível for terminal (Venda/Perdido/Pausado).
function fechamentoNaJanela(
	historico: CardComHistorico["historico"],
): { etapa: string; data: Date } | null {
	if (historico.length === 0) return null;
	const ultima = historico[historico.length - 1];
	if (!ETAPAS_FECHAMENTO.has(ultima.etapa)) return null;
	return { etapa: ultima.etapa, data: new Date(ultima.timestamp) };
}

// Conversão da coorte: % por fase a partir da fase mais avançada alcançada
// (com inferência de intermediárias), congelada em observarAte.
function calcularConversaoCoorte(
	comerciais: CardComHistorico[],
	observarAte: Date,
): KPIsFunilConversao {
	const contatoIdx = (ORDEM_ETAPAS as string[]).indexOf(ETAPA_BASE);
	const faseMaisAvancada = comerciais.map((c) =>
		indiceFaseMaisAvancada(c, observarAte),
	);
	const alcancaram = (i: number) =>
		faseMaisAvancada.filter((f) => f >= i).length;

	const totalBase = alcancaram(contatoIdx);

	// MESMO corte de calcularConversao — e é AQUI que ele mais importa.
	//
	// A primeira versão só tratava etapa não instrumentada no funil geral, que
	// roda sempre na gestão atual (um pipe só, tudo instrumentado): o corte
	// estava na única função onde não podia fazer diferença. Esta é a do
	// comparador, a única tela que atravessa gestões — e sem o corte ela
	// mostrava "Contato aberto: 80,97%" para 23/24, uma fase que não existia no
	// CRM da época, e "Pré-diagnóstico: 100% da anterior", que é a assinatura de
	// comparar contra uma fase inferida.
	const naoInstrumentadas = etapasNaoInstrumentadasDe(comerciais);
	const instrumentadas = ORDEM_ETAPAS.map((e, i) => ({ e, i })).filter(
		({ e }) => !naoInstrumentadas.has(e),
	);

	const etapas: EtapaConversao[] = ORDEM_ETAPAS.map((etapa, i) => {
		// QUANTIDADE = cards da coorte que alcançaram (pelo menos) esta fase.
		const quantidade = alcancaram(i);

		// A quantidade também é inferida, então também não pode ser afirmada.
		if (naoInstrumentadas.has(etapa)) {
			return { etapa, quantidade: 0, naoInstrumentada: true };
		}

		if (etapa === "Oportunidade") return { etapa, quantidade };

		const percentualRelativo =
			totalBase > 0 ? (quantidade / totalBase) * 100 : 0;

		let percentualEtapaAnterior: number | undefined;
		let baseEtapaAnterior: EtapaFunil | undefined;
		const posicao = instrumentadas.findIndex((x) => x.e === etapa);
		if (posicao > 0) {
			const anterior = instrumentadas[posicao - 1];
			baseEtapaAnterior = anterior.e;
			const alcancaramAnterior = alcancaram(anterior.i);
			percentualEtapaAnterior =
				alcancaramAnterior > 0 ? (quantidade / alcancaramAnterior) * 100 : 0;
		}

		return {
			etapa,
			quantidade,
			percentualRelativo,
			percentualEtapaAnterior,
			baseEtapaAnterior,
		};
	});

	return { etapas, totalBase };
}

// Tempo da coorte: mesma lógica de calcularTempo, mas com histórico congelado
// em observarAte (cards ainda abertos contam tempo até o corte, não até agora).
function calcularTempoCoorte(
	comerciais: CardComHistorico[],
	observarAte: Date,
): KPIsFunilTempo {
	const temposPorEtapa: Partial<Record<EtapaFunil, number[]>> = {};
	const diasAteVenda: number[] = [];
	const diasAteFechamento: number[] = [];

	comerciais.forEach((card) => {
		const lista = historicoAte(card, observarAte);
		if (lista.length === 0) return;

		const entradaNoFunil = new Date(lista[0].timestamp);
		const fechamento = fechamentoNaJanela(lista);

		if (fechamento) {
			const dias =
				(fechamento.data.getTime() - entradaNoFunil.getTime()) / DIA_MS;
			if (dias >= 0) {
				diasAteFechamento.push(dias);
				if (fechamento.etapa === "Venda") diasAteVenda.push(dias);
			}
		}

		lista.forEach((transicao, index) => {
			const etapa = transicao.etapa;
			if (!(ORDEM_ETAPAS as string[]).includes(etapa)) return;
			if (ETAPAS_FORA_TEMPO_POR_FASE.has(etapa)) return;

			const entradaEtapa = new Date(transicao.timestamp);
			const proxima = lista[index + 1];
			const saida = proxima
				? new Date(proxima.timestamp)
				: (fechamento?.data ?? observarAte);
			const horas = (saida.getTime() - entradaEtapa.getTime()) / (1000 * 60 * 60);

			const etapaFunil = etapa as EtapaFunil;
			if (!temposPorEtapa[etapaFunil]) temposPorEtapa[etapaFunil] = [];
			temposPorEtapa[etapaFunil]!.push(horas);
		});
	});

	const etapas = montarEtapasTempo(temposPorEtapa, comerciais);

	return {
		etapas,
		tempoMedioVendaDias: mediaDias(diasAteVenda),
		tempoMedioFechamentoDias: mediaDias(diasAteFechamento),
		totalVendas: diasAteVenda.length,
	};
}

// Calcula o funil completo de uma coorte (conversão + tempo + volume).
function calcularFunilJanela(
	cards: CardComHistorico[],
	janela: JanelaFunil,
): { conversao: KPIsFunilConversao; tempo: KPIsFunilTempo; volume: FunilVolume } {
	const de = janela.criadoDe.getTime();
	const ate = janela.criadoAte.getTime();

	const naJanela = cards.filter((c) => {
		if (!c.data_criacao) return false;
		const t = new Date(c.data_criacao).getTime();
		return !isNaN(t) && t >= de && t <= ate;
	});
	const comerciais = naJanela.filter(ehFunilComercial);

	const conversao = calcularConversaoCoorte(comerciais, janela.observarAte);
	const tempo = calcularTempoCoorte(comerciais, janela.observarAte);

	const vendaIdx = (ORDEM_ETAPAS as string[]).indexOf("Venda");
	const faseMaisAvancada = comerciais.map((c) =>
		indiceFaseMaisAvancada(c, janela.observarAte),
	);
	const entraramFunil = conversao.totalBase;
	const chegaramVenda = faseMaisAvancada.filter((f) => f >= vendaIdx).length;

	const volume: FunilVolume = {
		criados: naJanela.length,
		entraramFunil,
		chegaramVenda,
		conversaoTopoVenda:
			entraramFunil > 0 ? (chegaramVenda / entraramFunil) * 100 : 0,
	};

	return { conversao, tempo, volume };
}

// Maturidade da coorte (independe de equalização).
function maturidadeDe(jan: JanelaPeriodo, agora: Date): MaturidadeCoorte {
	const emAndamento = jan.fim.getTime() > agora.getTime();
	const fimEfetivo = emAndamento ? agora : jan.fim;
	return {
		emAndamento,
		emMaturacao: !emAndamento && diasEntre(jan.fim, agora) < LIMIAR_MATURACAO_DIAS,
		diasDecorridos: Math.max(0, diasEntre(jan.inicio, fimEfetivo)),
	};
}

// Monta a JanelaFunil de um período.
//   corte === null  → coorte completa: criados dentro do período, histórico até
//                     agora (resultado "definitivo" da safra).
//   corte !== null  → janela equalizada: trunca criação E observação no corte
//                     (alinha os dois lados pelo mesmo decorrido).
function montarJanelaFunil(
	jan: JanelaPeriodo,
	corte: Date | null,
	agora: Date,
): JanelaFunil {
	const fimOuAgora = jan.fim.getTime() < agora.getTime() ? jan.fim : agora;
	if (corte === null) {
		return { criadoDe: jan.inicio, criadoAte: fimOuAgora, observarAte: agora };
	}
	const limite = new Date(Math.min(corte.getTime(), fimOuAgora.getTime()));
	return { criadoDe: jan.inicio, criadoAte: limite, observarAte: limite };
}

// Unidade de equalização conforme o tipo do período.
function unidadeDe(sel: SelecaoPeriodoFunil): "dias" | "meses" {
	return sel.tipo === "mes" ? "dias" : "meses";
}

// Meses inteiros decorridos de `inicio` até `fim` (UTC; início já em BRT 03:00Z).
function mesesEntre(inicio: Date, fim: Date): number {
	return (
		(fim.getUTCFullYear() - inicio.getUTCFullYear()) * 12 +
		(fim.getUTCMonth() - inicio.getUTCMonth())
	);
}

function corteApos(inicio: Date, valor: number, unidade: "dias" | "meses"): Date {
	if (unidade === "dias") return new Date(inicio.getTime() + valor * DIA_MS);
	const d = new Date(inicio);
	d.setUTCMonth(d.getUTCMonth() + valor);
	return d;
}

/**
 * Comparativo de funil entre dois períodos (coortes).
 *
 * @param equalizar quando true (padrão), alinha os dois lados pela mesma idade
 *   H = dias decorridos do período em andamento (ou, se ambos fechados, a menor
 *   duração entre os dois). Torna justa a comparação contra um período recente.
 */
export function calcularComparativoFunilPeriodos(
	cards: CardComHistorico[],
	selA: SelecaoPeriodoFunil,
	selB: SelecaoPeriodoFunil,
	opts: { equalizar?: boolean; agora?: Date } = {},
): ComparativoFunilPeriodos {
	const equalizar = opts.equalizar ?? true;
	const agora = opts.agora ?? new Date();

	const janA = janelaPeriodo(selA);
	const janB = janelaPeriodo(selB);

	const aEmAndamento = janA.fim.getTime() > agora.getTime();
	const bEmAndamento = janB.fim.getTime() > agora.getTime();

	let corteA: Date | null = null;
	let corteB: Date | null = null;
	let janelaEqualizada: JanelaEqualizada | null = null;

	if (equalizar) {
		if (!aEmAndamento && !bEmAndamento) {
			// Cenário 1 — ambos finalizados: período COMPLETO de cada lado, sem
			// truncar (tanto faz 28/30/31 dias; o funil de cada um é o inteiro).
			janelaEqualizada = {
				modo: "completo",
				valor: 0,
				unidade: unidadeDe(selA),
			};
		} else {
			// Cenário 2 — algum período em andamento: alinha os dois pelo decorrido
			// do período em andamento, na unidade do tipo (dias p/ mês; meses p/
			// ciclo/gestão). Ex.: hoje é o 29º dia de jul → primeiros 29 dias de cada.
			const unidade = unidadeDe(aEmAndamento ? selA : selB);
			const decorrido = (jan: JanelaPeriodo) =>
				unidade === "dias"
					? diasEntre(jan.inicio, agora) + 1
					: mesesEntre(jan.inicio, agora) + 1;
			const valores: number[] = [];
			if (aEmAndamento) valores.push(decorrido(janA));
			if (bEmAndamento) valores.push(decorrido(janB));
			const valor = Math.max(1, Math.min(...valores));
			corteA = corteApos(janA.inicio, valor, unidade);
			corteB = corteApos(janB.inicio, valor, unidade);
			janelaEqualizada = { modo: "parcial", valor, unidade };
		}
	}

	const janFunilA = montarJanelaFunil(janA, corteA, agora);
	const janFunilB = montarJanelaFunil(janB, corteB, agora);

	const a: FunilPeriodo = {
		selecao: selA,
		janela: janelaISO(janFunilA),
		...calcularFunilJanela(cards, janFunilA),
		maturidade: maturidadeDe(janA, agora),
		// Janela da COORTE (criação), não a de observação: o que importa é se
		// havia CRM no ar quando esses cards teriam entrado.
		coberturaParcial: avisoDeLacunaFunil(janFunilA.criadoDe, janFunilA.criadoAte),
	};
	const b: FunilPeriodo = {
		selecao: selB,
		janela: janelaISO(janFunilB),
		...calcularFunilJanela(cards, janFunilB),
		maturidade: maturidadeDe(janB, agora),
		coberturaParcial: avisoDeLacunaFunil(janFunilB.criadoDe, janFunilB.criadoAte),
	};

	// Delta por etapa (b − a).
	const tempoA = new Map(a.tempo.etapas.map((e) => [e.etapa, e.tempoMedioHoras]));
	const tempoB = new Map(b.tempo.etapas.map((e) => [e.etapa, e.tempoMedioHoras]));
	const convA = new Map(a.conversao.etapas.map((e) => [e.etapa, e]));
	const convB = new Map(b.conversao.etapas.map((e) => [e.etapa, e]));

	const deltaEtapas: DeltaEtapaFunil[] = ORDEM_ETAPAS.map((etapa) => {
		const ca = convA.get(etapa);
		const cb = convB.get(etapa);
		const delta: DeltaEtapaFunil = { etapa };
		if (ca?.percentualRelativo !== undefined && cb?.percentualRelativo !== undefined)
			delta.deltaPercentualRelativo =
				cb.percentualRelativo - ca.percentualRelativo;
		// SÓ se os dois lados mediram a MESMA transição. Quando um período pula
		// uma etapa não instrumentada e o outro não, "Pré-diagnóstico" é medido
		// contra "Oportunidade" de um lado e contra "Contato aberto" do outro — a
		// subtração viraria uma queda de conversão que é só troca de denominador.
		// O percentual ACUMULADO (vs topo) continua comparável: mesma base nos dois.
		if (
			ca?.percentualEtapaAnterior !== undefined &&
			cb?.percentualEtapaAnterior !== undefined &&
			ca.baseEtapaAnterior === cb.baseEtapaAnterior
		)
			delta.deltaPercentualEtapaAnterior =
				cb.percentualEtapaAnterior - ca.percentualEtapaAnterior;
		const ta = tempoA.get(etapa);
		const tb = tempoB.get(etapa);
		if (ta !== undefined && tb !== undefined) delta.deltaTempoHoras = tb - ta;
		return delta;
	});

	const deltaVolume: FunilVolume = {
		criados: b.volume.criados - a.volume.criados,
		entraramFunil: b.volume.entraramFunil - a.volume.entraramFunil,
		chegaramVenda: b.volume.chegaramVenda - a.volume.chegaramVenda,
		conversaoTopoVenda:
			b.volume.conversaoTopoVenda - a.volume.conversaoTopoVenda,
	};

	return {
		a,
		b,
		deltaEtapas,
		deltaVolume,
		equalizado: equalizar,
		janelaEqualizada,
	};
}

function janelaISO(j: JanelaFunil): FunilPeriodo["janela"] {
	return {
		inicioISO: j.criadoDe.toISOString(),
		criadoAteISO: j.criadoAte.toISOString(),
		observarAteISO: j.observarAte.toISOString(),
	};
}
