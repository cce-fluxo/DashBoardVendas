import {
	Venda,
	MetaPeriodo,
	EtapaFunil,
	KPIsVendas,
	KPIsPorCoordenacao,
	KPIsPorVendedor,
	KPILTV,
	Coordenacao,
	PeriodoGestao,
	PeriodoCiclo,
	ComparativoAnalitico,
} from "@/types";
import { CardComHistorico } from "@/lib/supabase-funil";
import {
	COORDENACOES,
	apenasCoordenacoes,
	ehCrossSell,
	rotulosDesconhecidos,
} from "@/lib/coordenacoes";
import {
	anoInicioGestao,
	gestaoAnterior,
	mesesDoCicloDaGestao,
} from "@/lib/periodo-gestao";

// ─── Utilitários internos ────────────────────────────────────────

/**
 * Total vendido.
 *
 * Usa `valorVendidoReal` — o que de fato entrou para a empresa — e não
 * `valorContrato`. As duas colunas existem nas três planilhas e divergem de
 * verdade (em 23/24, por mais de duzentos mil reais). Decisão do dono do
 * processo.
 */
function somarValores(vendas: Venda[]): number {
	return vendas.reduce((acc, v) => acc + v.valorVendidoReal, 0);
}

/**
 * Valor que cada RESPONSÁVEL leva (ranking por vendedor e por canal).
 *
 * De 24/25 em diante é `valorContrato`. Até 23/24 a coluna "Valor contrato"
 * das planilhas não é o valor do projeto (em 23/24 chega a R$ 41 mil contra
 * R$ 3,7 mil vendidos de fato), então vale "Valor Vendido real". Decisão do dono
 * do processo.
 */
export function valorDoResponsavel(v: { gestao: string; valorContrato: number; valorVendidoReal: number }): number {
	return anoInicioGestao(v.gestao as PeriodoGestao) <= 2023 ? v.valorVendidoReal : v.valorContrato;
}

function apenasAssinadas(vendas: Venda[]): Venda[] {
	return vendas.filter((v) => v.assinado);
}

function porGestao(vendas: Venda[], gestao: PeriodoGestao): Venda[] {
	return vendas.filter((v) => v.gestao === gestao);
}

function porMes(vendas: Venda[], mes: string): Venda[] {
	return vendas.filter((v) => v.mes === mes);
}

/**
 * Filtra as vendas de um ciclo.
 *
 * Os meses vêm do registry via `mesesDoCicloDaGestao`. A tabela trimestral que
 * existia aqui era a TERCEIRA cópia hardcoded do calendário no projeto, e como
 * as outras duas estava errada para 23/24 e 24/25 — que têm 3 ciclos de 4 meses,
 * não 4 trimestres.
 */
function porCiclo(
	vendas: Venda[],
	ciclo: PeriodoCiclo,
	gestao: PeriodoGestao,
): Venda[] {
	const meses = mesesDoCicloDaGestao(ciclo, gestao);
	return vendas.filter((v) => {
		const mesNum = v.mes?.split("/")[0]?.padStart(2, "0");
		return meses.includes(mesNum);
	});
}

// ─── Utilitário: meses decorridos desde outubro ───────────────────

export function calcularMesesDecorridos(
	gestao: PeriodoGestao,
	filtro?: {
		tipo: "gestao" | "ciclo" | "mes";
		ciclo?: string;
		mes?: string;
	},
): {
	mesesDecorridos: number;
	mesesAtual: string[];
	mesesEquivalente: string[];
	descricaoAtual: string;
	descricaoEquivalente: string;
} {
	const NOMES_MESES: Record<string, string> = {
		"01": "Jan",
		"02": "Fev",
		"03": "Mar",
		"04": "Abr",
		"05": "Mai",
		"06": "Jun",
		"07": "Jul",
		"08": "Ago",
		"09": "Set",
		"10": "Out",
		"11": "Nov",
		"12": "Dez",
	};

	const sequenciaMeses = [
		"10",
		"11",
		"12",
		"01",
		"02",
		"03",
		"04",
		"05",
		"06",
		"07",
		"08",
		"09",
	];

	const anoInicioAtual = anoInicioGestao(gestao);
	const anoInicioAnterior = anoInicioAtual - 1;

	let mesesAtual: string[];
	let mesesEquivalente: string[];
	let mesesDecorridos: number;
	let descricaoAtual: string;
	let descricaoEquivalente: string;

	if (filtro?.tipo === "mes" && filtro.mes) {
		// Filtro de mês — compara só esse mês
		mesesAtual = [filtro.mes];
		mesesEquivalente = [filtro.mes];
		mesesDecorridos = 1;

		const anoAtual =
			parseInt(filtro.mes) >= 10 ? anoInicioAtual : anoInicioAtual + 1;
		const anoAnterior =
			parseInt(filtro.mes) >= 10 ? anoInicioAnterior : anoInicioAnterior + 1;
		descricaoAtual = `${NOMES_MESES[filtro.mes]}/${String(anoAtual).slice(2)}`;
		descricaoEquivalente = `${NOMES_MESES[filtro.mes]}/${String(anoAnterior).slice(2)}`;
	} else if (filtro?.tipo === "ciclo" && filtro.ciclo) {
		// Filtro de ciclo — compara os meses do ciclo
		// Ciclo do registry da gestão CORRENTE. O período equivalente usa os
		// mesmos meses — comparar "o mesmo trecho do ano" continua valendo mesmo
		// quando as duas gestões dividem o ano de formas diferentes.
		mesesAtual = mesesDoCicloDaGestao(filtro.ciclo, gestao);
		mesesEquivalente = mesesAtual;
		mesesDecorridos = mesesAtual.length;

		const primeiroMes = mesesAtual[0];
		const ultimoMes = mesesAtual[mesesAtual.length - 1];
		const anoInicioQ =
			parseInt(primeiroMes) >= 10 ? anoInicioAtual : anoInicioAtual + 1;
		const anoFimQ =
			parseInt(ultimoMes) >= 10 ? anoInicioAtual : anoInicioAtual + 1;
		const anoInicioQAnt =
			parseInt(primeiroMes) >= 10 ? anoInicioAnterior : anoInicioAnterior + 1;
		const anoFimQAnt =
			parseInt(ultimoMes) >= 10 ? anoInicioAnterior : anoInicioAnterior + 1;

		descricaoAtual = `${NOMES_MESES[primeiroMes]}/${String(anoInicioQ).slice(2)} — ${NOMES_MESES[ultimoMes]}/${String(anoFimQ).slice(2)}`;
		descricaoEquivalente = `${NOMES_MESES[primeiroMes]}/${String(anoInicioQAnt).slice(2)} — ${NOMES_MESES[ultimoMes]}/${String(anoFimQAnt).slice(2)}`;
	} else {
		// Filtro de gestão — usa meses decorridos até hoje
		const hoje = new Date();
		const mesAtualReal = (hoje.getMonth() + 1).toString().padStart(2, "0");
		const anoAtualReal = hoje.getFullYear();

		if (
			anoAtualReal > anoInicioAtual + 1 ||
			(anoAtualReal === anoInicioAtual + 1 && hoje.getMonth() > 8)
		) {
			mesesDecorridos = 12;
		} else if (
			anoAtualReal < anoInicioAtual ||
			(anoAtualReal === anoInicioAtual && hoje.getMonth() < 9)
		) {
			mesesDecorridos = 1;
		} else {
			const index = sequenciaMeses.indexOf(mesAtualReal);
			mesesDecorridos = index !== -1 ? index + 1 : 12;
		}

		mesesAtual = sequenciaMeses.slice(0, mesesDecorridos);
		mesesEquivalente = sequenciaMeses.slice(0, mesesDecorridos);
		descricaoAtual = `Gestão ${gestao}`;
		descricaoEquivalente = `Gestão ${gestaoAnterior(gestao)}`;
	}
	return {
		mesesDecorridos,
		mesesAtual,
		mesesEquivalente,
		descricaoAtual,
		descricaoEquivalente,
	};
}

// ─── Comparativo analítico ────────────────────────────────────────

export function calcularComparativoAnalitico(
	vendasAtuais: Venda[],
	vendasAnteriores: Venda[],
	// `null` = período sem meta cadastrada. O ritmo linear vira zero e a tela
	// mostra "sem meta definida" em vez de comparar contra um alvo emprestado.
	meta: MetaPeriodo | null,
	gestao: PeriodoGestao,
	cards: CardComHistorico[],
	filtro: {
		tipo: "gestao" | "ciclo" | "mes";
		ciclo?: string;
		mes?: string;
	},
): ComparativoAnalitico {
	const {
		mesesDecorridos,
		mesesAtual,
		mesesEquivalente,
		descricaoAtual,
		descricaoEquivalente,
	} = calcularMesesDecorridos(gestao, filtro);

	// Filtra vendas pelo período equivalente
	const vendasNoPeriodoAtual = apenasAssinadas(vendasAtuais).filter((v) =>
		mesesAtual.includes(v.mes),
	);

	const vendasNoPeriodoAnterior = apenasAssinadas(vendasAnteriores).filter(
		(v) => mesesEquivalente.includes(v.mes),
	);

	// KPIs do período atual
	const totalAtual = somarValores(vendasNoPeriodoAtual);
	const qtdAtual = vendasNoPeriodoAtual.length;
	const ticketAtual = qtdAtual > 0 ? totalAtual / qtdAtual : 0;
	// Conversão do período: fração de cards (do Supabase, via histórico) que
	// chegaram a "Venda" em algum momento. Migrado de CardCRM (Pipefy ao vivo)
	// para CardComHistorico — não chamamos mais a API do Pipefy na renderização.
	const conversaoAtual =
		cards.length > 0
			? (cards.filter((c) => c.historico.some((h) => h.etapa === "Venda"))
					.length /
					cards.length) *
				100
			: 0;

	// KPIs do período equivalente anterior
	const totalAnterior = somarValores(vendasNoPeriodoAnterior);
	const qtdAnterior = vendasNoPeriodoAnterior.length;
	const ticketAnterior = qtdAnterior > 0 ? totalAnterior / qtdAnterior : 0;

	const temGestaoAnterior = vendasAnteriores.length > 0;

	// Variações
	const variacoes = temGestaoAnterior
		? {
				totalVendido:
					totalAnterior > 0
						? ((totalAtual - totalAnterior) / totalAnterior) * 100
						: 0,
				numeroDeVendas:
					qtdAnterior > 0 ? ((qtdAtual - qtdAnterior) / qtdAnterior) * 100 : 0,
				ticketMedio:
					ticketAnterior > 0
						? ((ticketAtual - ticketAnterior) / ticketAnterior) * 100
						: 0,
				taxaConversao: conversaoAtual - 0,
			}
		: null;

	// Linear da meta
	const metaAnual = meta?.metaVendas ?? 0;
	const metaLinear = (mesesDecorridos / 12) * metaAnual;
	const adiantamento = totalAtual - metaLinear;
	const projecaoAnual =
		mesesDecorridos > 0 ? (totalAtual / mesesDecorridos) * 12 : 0;

	return {
		periodoAtual: {
			descricao: descricaoAtual,
			totalMeses: mesesDecorridos,
			totalVendido: totalAtual,
			numeroDeVendas: qtdAtual,
			ticketMedio: ticketAtual,
			taxaConversao: conversaoAtual,
		},
		periodoEquivalente: temGestaoAnterior
			? {
					descricao: descricaoEquivalente,
					totalMeses: mesesDecorridos,
					totalVendido: totalAnterior,
					numeroDeVendas: qtdAnterior,
					ticketMedio: ticketAnterior,
					taxaConversao: 0,
				}
			: null,
		variacoes,
		linear: {
			metaAnual,
			mesesDecorridos,
			totalMeses: 12,
			metaLinear,
			realizado: totalAtual,
			variacao:
				metaLinear > 0 ? ((totalAtual - metaLinear) / metaLinear) * 100 : 0,
			adiantamento,
			projecaoAnual,
		},
	};
}

// ─── Vendas e metas ─────────────────────────────────────────

export function calcularKPIsVendas(
	vendas: Venda[],
	// `null` = não há meta cadastrada para este período. Diferente de meta zero.
	meta: MetaPeriodo | null,
	vendasAnteriores?: Venda[],
): KPIsVendas {
	const assinadas = apenasAssinadas(vendas);
	const totalVendido = somarValores(assinadas);
	const numeroDeVendas = assinadas.length;
	const ticketMedio = numeroDeVendas > 0 ? totalVendido / numeroDeVendas : 0;
	const metaDefinida = meta !== null && meta.metaVendas > 0;
	const valorMeta = metaDefinida ? meta!.metaVendas : 0;
	const percentualMeta = metaDefinida ? (totalVendido / valorMeta) * 100 : 0;
	const gapMeta = metaDefinida ? valorMeta - totalVendido : 0;

	let variacaoVsGestaoAnterior: number | undefined = undefined;
	if (vendasAnteriores && vendasAnteriores.length > 0) {
		const totalAnterior = somarValores(apenasAssinadas(vendasAnteriores));
		if (totalAnterior > 0) {
			variacaoVsGestaoAnterior =
				((totalVendido - totalAnterior) / totalAnterior) * 100;
		} else if (totalVendido > 0) {
			variacaoVsGestaoAnterior = 100; // Crescimento de 100% se antes era 0 e agora > 0
		} else {
			variacaoVsGestaoAnterior = 0;
		}
	}

	return {
		totalVendido,
		numeroDeVendas,
		ticketMedio,
		metaVendas: valorMeta,
		metaDefinida,
		percentualMeta,
		gapMeta,
		variacaoVsGestaoAnterior,
	};
}

// ─── Por coordenação ─────────────────────────────────────────────
//
// Migrado de CardCRM para CardComHistorico (Supabase).
// Regras corrigidas:
//   oportunidadesNoFunil → apenas fases comerciais ativas (exclui Venda, Perdido, Pausado)
//   projetosEmNegociacao → Precificação-com-valor + Proposta + Follow-up
//   valorAFechar         → mesmo conjunto, soma de valor_contrato
//   metaVendas      → meta específica da coordenação no período

// Fases que contam como "oportunidade ativa no funil"
const FASES_ATIVAS_FUNIL = new Set([
	"Oportunidade",
	"Contato aberto",
	"Pré-diagnóstico feito",
	"Diagnóstico feito",
	"Precificação/Aprovação em andamento",
	"Proposta comercial feita",
	"Follow-up",
]);

// Fases que entram em "em negociação" e "valor a fechar"
// Precificação só entra se tiver valor_contrato definido (verificado abaixo)
const FASES_NEGOCIACAO = new Set([
	"Precificação/Aprovação em andamento",
	"Proposta comercial feita",
	"Follow-up",
]);

export function calcularKPIsPorCoordenacao(
	vendas: Venda[],
	cards: CardComHistorico[],
	metasPorCoord: Partial<Record<Coordenacao, number>> = {},
): KPIsPorCoordenacao[] {
	return COORDENACOES.map((coord) => {
		const vendasCoord = apenasAssinadas(vendas).filter(
			(v) => v.coordenacao === coord,
		);
		// Cards onde esta coordenação aparece no array — inclui cross-sell
		const cardsCoord = cards.filter((c) => c.coordenacoes.includes(coord));

		const totalVendido = somarValores(vendasCoord);
		const numeroDeVendas = vendasCoord.length;
		const ticketMedio = numeroDeVendas > 0 ? totalVendido / numeroDeVendas : 0;

		// Oportunidades ativas: exclui Venda, Perdido e Pausado
		const oportunidadesNoFunil = cardsCoord.filter((c) =>
			FASES_ATIVAS_FUNIL.has(c.etapa_atual),
		).length;

		// Em negociação: TODOS os cards desta coordenação nas 3 fases.
		//
		// Antes, um card em "Precificação/Aprovação em andamento" sem valor de
		// proposta era descartado aqui — sumia da contagem E da lista. Precificação
		// sem valor é justamente o card que ainda não foi precificado: o estado
		// normal da fase, não um registro inválido. Descartá-lo fazia a tabela
		// mostrar 20 dos 23 projetos abertos, sem nada indicando os outros 3.
		//
		// O valor continua fora do total (ver `valorAFechar` abaixo): contar o
		// projeto e somar R$ 0 são coisas diferentes.
		const emNegociacao = cards.filter(
			(card) =>
				card.coordenacoes.includes(coord) &&
				FASES_NEGOCIACAO.has(card.etapa_atual),
		);

		// Valor a fechar: só o que TEM valor. Cross-sell entra em cheio em cada
		// coordenação participante — a dedução acontece na linha de total.
		const valorAFechar = emNegociacao.reduce(
			(acc, card) => acc + (card.valor_contrato ?? 0),
			0,
		);

		const projetosEmNegociacao = emNegociacao.map((card) => ({
			id_card: card.id_card,
			titulo: card.nome_card,
			valor: card.valor_contrato ?? 0,
			etapa: card.etapa_atual as EtapaFunil,
			// Cross-sell é ter DUAS COORDENAÇÕES reconhecidas. Era
			// `coordenacoes.length > 1`, verdadeiro em 98,5% do board porque a
			// ingestão gravava IDs do Pipefy junto dos rótulos.
			isCrossSell: ehCrossSell(card.coordenacoes),
			coordenacoes: apenasCoordenacoes(card.coordenacoes),
		}));

		return {
			coordenacao: coord,
			totalVendido,
			numeroDeVendas,
			ticketMedio,
			valorAFechar,
			oportunidadesNoFunil,
			projetosEmNegociacao,
			metaVendas: metasPorCoord[coord] ?? 0,
		};
	});
}

/**
 * Projetos em negociação que não aparecem em NENHUMA linha da tabela.
 *
 * O campo "Coordenação" do Pipefy aceita valores fora das cinco ("NP", "AN",
 * "N2") e pode ficar em branco. Um card assim some da tabela por coordenação —
 * e some em silêncio, que é o modo de falhar que este projeto persegue desde o
 * começo: quem olha a tela não tem como distinguir "não existe" de "existe e
 * não foi classificado".
 *
 * Não é alarme, é nota: a correção é no Pipefy, e o número da tabela não está
 * errado — está incompleto, e a diferença precisa estar escrita.
 */
export function negociacoesSemCoordenacao(cards: CardComHistorico[]): {
	quantidade: number;
	valor: number;
	rotulos: string[];
} {
	const orfaos = cards.filter(
		(c) =>
			FASES_NEGOCIACAO.has(c.etapa_atual) &&
			apenasCoordenacoes(c.coordenacoes).length === 0,
	);

	return {
		quantidade: orfaos.length,
		valor: orfaos.reduce((acc, c) => acc + (c.valor_contrato ?? 0), 0),
		// Distingue "preenchido com algo que não é coordenação" de "em branco" —
		// são erros diferentes, com correções diferentes no Pipefy.
		rotulos: [
			...new Set(orfaos.flatMap((c) => rotulosDesconhecidos(c.coordenacoes))),
		].sort(),
	};
}

// ─── Por vendedor ────────────────────────────────────────────────

export function calcularKPIsPorVendedor(vendas: Venda[]): KPIsPorVendedor[] {
	const assinadas = apenasAssinadas(vendas);
	const mapaVendedor: Record<string, { total: number; quantidade: number }> =
		{};

	assinadas.forEach((venda) => {
		const responsaveis = [
			venda.responsavel1,
			venda.responsavel2,
			venda.responsavel3,
			venda.responsavel4,
		].filter(Boolean) as string[];

		// Cada responsável recebe o valor TOTAL do projeto
		responsaveis.forEach((resp) => {
			if (!mapaVendedor[resp]) {
				mapaVendedor[resp] = { total: 0, quantidade: 0 };
			}
			mapaVendedor[resp].total += valorDoResponsavel(venda);
			mapaVendedor[resp].quantidade += 1;
		});
	});

	return Object.entries(mapaVendedor)
		.map(([responsavel, { total, quantidade }]) => ({
			responsavel,
			totalVendido: total,
			numeroDeVendas: quantidade,
			ticketMedio: quantidade > 0 ? total / quantidade : 0,
		}))
		.sort((a, b) => b.totalVendido - a.totalVendido);
}

// ─── Por canal de aquisição ──────────────────────────────────────

export function calcularKPIsPorCanal(vendas: Venda[]) {
	const assinadas = apenasAssinadas(vendas);
	const mapa: Record<string, { total: number; quantidade: number }> = {};

	assinadas.forEach((v) => {
		const canal = v.canalDeAquisicao || "Não informado";
		if (!mapa[canal]) mapa[canal] = { total: 0, quantidade: 0 };
		mapa[canal].total += valorDoResponsavel(v);
		mapa[canal].quantidade += 1;
	});

	return Object.entries(mapa)
		.map(([canal, { total, quantidade }]) => ({
			canal,
			totalVendido: total,
			numeroDeVendas: quantidade,
		}))
		.sort((a, b) => b.totalVendido - a.totalVendido);
}

// ─── Vendas por mês (série temporal para gráfico de linha) ───────
// Ordenado na sequência da gestão (Out → Set). Usa apenas vendas assinadas.

export function calcularVendasPorMes(
	vendas: Venda[],
): {
	mes: string;
	label: string;
	totalVendido: number;
	numeroDeVendas: number;
}[] {
	const SEQUENCIA = [
		"10", "11", "12", "01", "02", "03",
		"04", "05", "06", "07", "08", "09",
	];
	const LABELS: Record<string, string> = {
		"01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr",
		"05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago",
		"09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
	};

	const assinadas = apenasAssinadas(vendas);

	return SEQUENCIA.map((mes) => {
		const doMes = assinadas.filter((v) => v.mes === mes);
		return {
			mes,
			label: LABELS[mes],
			totalVendido: somarValores(doMes),
			numeroDeVendas: doMes.length,
		};
	});
}

// ─── LTV ─────────────────────────────────────────────────────────

export function calcularLTV(vendas: Venda[]): KPILTV {
	const assinadas = apenasAssinadas(vendas);
	const totalVendido = somarValores(assinadas);
	const ticketMedio =
		assinadas.length > 0 ? totalVendido / assinadas.length : 0;

	const fidelizadas = assinadas.filter((v) => v.fidelizacao).length;
	const mediaRenovacoes =
		assinadas.length > 0 ? fidelizadas / assinadas.length : 0;

	const ltv = ticketMedio * (1 + mediaRenovacoes);

	return { ticketMedio, mediaRenovacoes, ltv };
}

// ─── Filtros de período (exportados para uso nos componentes) ────

export { porGestao, porMes, porCiclo, apenasAssinadas };
