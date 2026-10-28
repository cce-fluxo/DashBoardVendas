// src/lib/tv.ts
//
// Os números do painel de TV (/tv), montados a partir dos MESMOS cálculos das
// telas do dashboard. Puro e sem rede: a rota busca, esta função conta.
//
// Nenhuma regra nova de negócio mora aqui. Funil vem de calculations-funil.ts,
// vendas e ranking de calculations.ts. Se um número da TV divergir do
// /dashboard no mesmo período, o erro está aqui — não há segunda definição.

import type { CardComHistorico } from "@/lib/supabase-funil";
import {
	calcularComparativoFunilPeriodos,
	calcularKPIsFunilCompleto,
} from "@/lib/calculations-funil";
import { calcularKPIsPorVendedor, calcularKPIsVendas } from "@/lib/calculations";
import { buscarGestao, idsDeGestao } from "@/lib/fontes/registry";
import { mesesDoCiclo } from "@/lib/fontes/calendario";
import { metaDoPeriodo, type SelecaoPeriodo } from "@/lib/metas-periodo";
import {
	gestaoAnterior,
	gestaoAtual,
	janelaCiclo,
	janelaGestao,
	mesesDoCicloDaGestao,
} from "@/lib/periodo-gestao";
import { iniciais, type ResolverPessoa } from "@/lib/pessoas";
import type { FaturamentoMes, ProjetoEntrega } from "@/lib/supabase-vendas";
import type {
	EtapaFunil,
	KPIsFunilConversao,
	MetaPeriodo,
	PeriodoCiclo,
	PeriodoGestao,
	SelecaoPeriodoFunil,
	Venda,
} from "@/types";

// ─── Tipos da resposta ────────────────────────────────────────────

export type TelaTv = "metas" | "funil" | "ranking-gestao" | "ranking-historico" | "fechados" | "entregas";

export interface TvEntrega {
	projeto: string;
	coordenacao: string;
	equipe: number | null;
	/** Gerente e consultores. Quem está na base de pessoas vem com nome curto e foto. */
	pessoas: TvPessoa[];
	/** Gestão da entrega, pela data. */
	gestao: string | null;
	/** "AAAA-MM-DD". */
	data: string;
	diasAtras: number;
}

export interface TvEntregas {
	gestao: string;
	gestaoAnterior: string;
	/** As mais recentes, de qualquer gestão: em out/26 a 26/27 ainda não entregou nada. */
	entregas: TvEntrega[];
	totalGestao: number;
	totalAnterior: number;
	/** Só as com data no ciclo: sem data não se sabe o ciclo. */
	noCiclo: number;
	ciclo: string;
	emExecucao: number;
}

export interface TvMetaMes {
	/** "outubro" */
	nome: string;
	/** "out" */
	abrev: string;
	vendido: number;
	/** null = a planilha não tem meta para o mês ("?????"). Não é meta zero. */
	metaVendas: number | null;
	faturado: number | null;
	previsto: number | null;
	metaFaturamento: number | null;
}

export interface TvMetas {
	ciclo: string;
	semana: number;
	semanas: number;
	faltamDias: number;
	/** Quanto do mês já passou, 0–1: onde a barra do mês "deveria" estar hoje. */
	hojeNoMes: number;
	/** Os meses do ciclo, na ordem. */
	meses: TvMetaMes[];
	mesAtual: number;
	vendidoCiclo: number;
	metaVendasCiclo: number | null;
	metaFaturamentoCiclo: number | null;
	/** Vendido no ciclo por semana decorrida. */
	ritmoSemana: number;
	/** O que falta da meta do ciclo por semana restante. null sem meta. */
	precisaSemana: number | null;
	/** Soma de valor_contrato dos cards em proposta agora. */
	propostasAbertas: number;
}

export interface TvFunil {
	ciclo: string;
	etapas: { nome: string; quantidade: number }[];
	/** Entre etapas consecutivas, 0–1. null quando a anterior é zero. */
	taxas: (number | null)[];
	conversaoTotal: number | null;
	/** Pontos percentuais vs. ciclo anterior na MESMA idade. null sem base. */
	vsCicloAnterior: number | null;
	ticketMedio: number;
	diasAteVenda: number;
	propostasAbertas: number;
}

export interface TvPessoa {
	nome: string;
	iniciais: string;
	/** null = sem foto em pessoa.foto_url; a tela mostra as iniciais. */
	foto: string | null;
}

export interface TvVendedor extends TvPessoa {
	vendido: number;
	contratos: number;
}

export interface TvRanking {
	rotulo: string;
	vendedores: TvVendedor[];
	totalVendido: number;
	ticketMedio: number;
	pessoasComContrato: number;
	maiorContrato: { valor: number; cliente: string } | null;
}

export interface TvFechado {
	cliente: string;
	projeto: string;
	valor: number;
	/** "AAAA-MM-DD". Quando `dataExata` é false, é o 1º dia do mês da venda. */
	data: string;
	dataExata: boolean;
	/** Dias desde a assinatura. null sem data exata — contar do dia 1º inventaria precisão. */
	diasAtras: number | null;
	responsaveis: TvPessoa[];
	coordenacao: string;
}

export interface TvFechados {
	gestao: string;
	gestaoAnterior: string | null;
	fechados: TvFechado[];
	totalGestao: number;
	/** Contratos da gestão anterior até o mesmo dia. null sem dado. */
	anteriorMesmoPonto: number | null;
	valorCiclo: number;
	ciclo: string;
	/** Contratos por semana desde 01/10. */
	mediaPorSemana: number;
}

export interface TvData {
	gestao: string;
	ciclo: string;
	/** Só as telas com dado. Tela vazia sai do ciclo, não mostra zero. */
	telas: TelaTv[];
	metas: TvMetas;
	funil: TvFunil;
	rankingGestao: TvRanking;
	rankingHistorico: TvRanking;
	fechados: TvFechados;
	entregas: TvEntregas;
}

// ─── Comemoração de contrato novo ─────────────────────────────────

/** Sem valor nem data: corrigir o valor na planilha não é venda nova. */
export function chaveDoFechado(f: TvFechado): string {
	return `${f.coordenacao}|${f.projeto}`;
}

const DIAS_PARA_COMEMORAR = 7;

/**
 * Contratos que a TV ainda não viu, do mais antigo ao mais novo (ordem da
 * fila). Só recentes: linha antiga apagada e recolocada na planilha não é venda.
 */
export function fechadosNovos(vistos: Set<string>, fechados: TvFechado[]): TvFechado[] {
	return fechados
		.filter((f) => !vistos.has(chaveDoFechado(f)) && f.diasAtras !== null && f.diasAtras <= DIAS_PARA_COMEMORAR)
		.reverse();
}

// ─── Calendário ───────────────────────────────────────────────────

/**
 * Ciclo que contém `hoje` na gestão. Fora dela (gestão vigente ainda sem
 * planilha, e a tela caiu na mais recente cadastrada), o último ciclo.
 */
export function cicloVigente(gestao: PeriodoGestao, hoje: Date): PeriodoCiclo {
	const ciclos = buscarGestao(gestao).ciclos;
	const atual = ciclos.find((c) => {
		const j = janelaCiclo(c.id, gestao);
		return hoje >= j.inicio && hoje <= j.fim;
	});
	return (atual ?? ciclos[ciclos.length - 1]).id;
}

/** Ciclo anterior, atravessando a virada de gestão. null antes da primeira. */
function cicloAnterior(
	gestao: PeriodoGestao,
	ciclo: PeriodoCiclo,
): SelecaoPeriodoFunil | null {
	const ciclos = buscarGestao(gestao).ciclos;
	const i = ciclos.findIndex((c) => c.id === ciclo);
	if (i > 0) return { tipo: "ciclo", gestao, ciclo: ciclos[i - 1].id };
	const ant = gestaoAnterior(gestao);
	if (!idsDeGestao().includes(ant)) return null;
	const cs = buscarGestao(ant).ciclos;
	return { tipo: "ciclo", gestao: ant, ciclo: cs[cs.length - 1].id };
}

function vendasDoCiclo(vendas: Venda[], gestao: PeriodoGestao, ciclo: PeriodoCiclo): Venda[] {
	const c = buscarGestao(gestao).ciclos.find((x) => x.id === ciclo)!;
	const meses = mesesDoCiclo(c);
	return vendas.filter((v) => v.gestao === gestao && meses.includes(v.mes));
}

// ─── Funil ────────────────────────────────────────────────────────

// As quatro caixas do Figma sobre as oito etapas do Pipefy.
const CAIXAS: { nome: string; etapa: EtapaFunil }[] = [
	{ nome: "Leads", etapa: "Oportunidade" },
	{ nome: "Qualificados", etapa: "Pré-diagnóstico feito" },
	{ nome: "Propostas", etapa: "Proposta comercial feita" },
	{ nome: "Fechados", etapa: "Venda" },
];

const EM_PROPOSTA = new Set(["Proposta comercial feita", "Follow-up"]);

/**
 * Quantos cards PASSARAM pela etapa — o funil do Figma é de passagem.
 *
 * `EtapaConversao.quantidade` é outra pergunta ("quantos estão nela agora") e
 * daria um funil que não afunila. A passagem já está em `percentualRelativo`,
 * sobre `totalBase` (Oportunidade); reconstruir daí evita uma segunda regra
 * de "alcançou", com a inferência de fases intermediárias que a original tem.
 */
function passaram(conv: KPIsFunilConversao, etapa: EtapaFunil): number {
	const e = conv.etapas.find((x) => x.etapa === etapa);
	if (!e || e.percentualRelativo === undefined) return 0;
	return Math.round((e.percentualRelativo / 100) * conv.totalBase);
}

function conversaoTotal(conv: KPIsFunilConversao): number | null {
	return conv.totalBase > 0 ? passaram(conv, "Venda") / conv.totalBase : null;
}

function montarFunil(
	cards: CardComHistorico[],
	vendas: Venda[],
	gestao: PeriodoGestao,
	ciclo: PeriodoCiclo,
	hoje: Date,
): TvFunil {
	const sel: SelecaoPeriodoFunil = { tipo: "ciclo", gestao, ciclo };
	const { geral } = calcularKPIsFunilCompleto(cards, sel);
	const qtd = CAIXAS.map((c) => passaram(geral.conversao, c.etapa));

	// Ciclo em andamento contra ciclo fechado, na mesma idade. Sem equalizar, um
	// ciclo de três semanas sempre "perde" — a safra ainda não teve tempo de fechar.
	const ant = cicloAnterior(gestao, ciclo);
	let vs: number | null = null;
	if (ant) {
		const cmp = calcularComparativoFunilPeriodos(cards, ant, sel, { agora: hoje });
		const a = conversaoTotal(cmp.a.conversao);
		const b = conversaoTotal(cmp.b.conversao);
		if (a !== null && b !== null) vs = (b - a) * 100;
	}

	return {
		ciclo: buscarGestao(gestao).ciclos.find((c) => c.id === ciclo)!.rotulo,
		etapas: CAIXAS.map((c, i) => ({ nome: c.nome, quantidade: qtd[i] })),
		taxas: qtd.slice(1).map((q, i) => (qtd[i] > 0 ? q / qtd[i] : null)),
		conversaoTotal: conversaoTotal(geral.conversao),
		vsCicloAnterior: vs,
		ticketMedio: calcularKPIsVendas(vendasDoCiclo(vendas, gestao, ciclo), null).ticketMedio,
		diasAteVenda: geral.tempo.tempoMedioVendaDias,
		// O board de AGORA, não a safra do ciclo: é "o que está em proposta hoje".
		propostasAbertas: cards.filter((c) => EM_PROPOSTA.has(c.etapa_atual)).length,
	};
}

// ─── Ranking ──────────────────────────────────────────────────────

function pessoaTv(nome: string, fotos: Map<string, string>): TvPessoa {
	return { nome, iniciais: iniciais(nome), foto: fotos.get(nome) ?? null };
}

function montarRanking(
	vendas: Venda[],
	rotulo: string,
	fotos: Map<string, string>,
): TvRanking {
	const assinadas = vendas.filter((v) => v.assinado);
	// Total e ticket vêm de calcularKPIsVendas, NÃO da soma do ranking: cada
	// responsável leva o valor inteiro do contrato, então somar o ranking conta
	// o mesmo contrato duas, três, quatro vezes.
	const kpis = calcularKPIsVendas(assinadas, null);
	const maior = assinadas.reduce<Venda | null>(
		(m, v) => (!m || v.valorVendidoReal > m.valorVendidoReal ? v : m),
		null,
	);
	const vendedores = calcularKPIsPorVendedor(assinadas).map((k) => ({
		...pessoaTv(k.responsavel, fotos),
		vendido: k.totalVendido,
		contratos: k.numeroDeVendas,
	}));
	return {
		rotulo,
		vendedores,
		totalVendido: kpis.totalVendido,
		ticketMedio: kpis.ticketMedio,
		pessoasComContrato: vendedores.length,
		maiorContrato: maior
			? { valor: maior.valorVendidoReal, cliente: maior.contratante ?? maior.projetoAssinado }
			: null,
	};
}

// ─── Últimos fechados ─────────────────────────────────────────────

/** Data do contrato para ordenar: a de assinatura, ou o 1º dia do mês. */
function dataDe(v: Venda, anoInicio: number): { data: string; exata: boolean } {
	if (v.dataAssinatura) return { data: v.dataAssinatura, exata: true };
	const mm = parseInt(v.mes, 10);
	const ano = mm >= 10 ? anoInicio : anoInicio + 1;
	return { data: `${ano}-${v.mes}-01`, exata: false };
}

/** "AAAA-MM-DD" de `d` em horário de Brasília. */
function diaBrasil(d: Date): string {
	return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

function montarFechados(
	vendas: Venda[],
	gestao: PeriodoGestao,
	ciclo: PeriodoCiclo,
	hoje: Date,
	fotos: Map<string, string>,
): TvFechados {
	const anoInicio = buscarGestao(gestao).anoInicio;
	const daGestao = vendas.filter((v) => v.gestao === gestao && v.assinado);
	const hojeBr = diaBrasil(hoje);
	const diasEntreDatas = (a: string, b: string) =>
		Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

	const fechados = daGestao
		.map((v) => ({ v, ...dataDe(v, anoInicio) }))
		.sort((a, b) => b.data.localeCompare(a.data))
		.slice(0, 4)
		.map(({ v, data, exata }) => ({
			// Contratante só existe a partir de 25/26.
			cliente: v.contratante ?? v.projetoAssinado,
			projeto: v.projetoAssinado,
			valor: v.valorVendidoReal,
			data,
			dataExata: exata,
			diasAtras: exata ? diasEntreDatas(data, hojeBr) : null,
			responsaveis: [v.responsavel1, v.responsavel2, v.responsavel3, v.responsavel4]
				.filter((n): n is string => Boolean(n))
				.map((nome) => pessoaTv(nome, fotos)),
			coordenacao: v.coordenacao,
		}));

	// "Mesma altura da gestão anterior": mesmo número de dias desde 01/10. Só
	// compara se a gestão anterior tem data de assinatura — por mês empataria o
	// mês inteiro e a comparação ficaria otimista ou pessimista conforme o dia.
	const ant = gestaoAnterior(gestao);
	let anteriorMesmoPonto: number | null = null;
	if (idsDeGestao().includes(ant)) {
		const daAnterior = vendas.filter((v) => v.gestao === ant && v.assinado);
		if (daAnterior.length > 0 && daAnterior.every((v) => v.dataAssinatura)) {
			const decorrido = hoje.getTime() - janelaGestao(gestao).inicio.getTime();
			const limite = diaBrasil(new Date(janelaGestao(ant).inicio.getTime() + decorrido));
			anteriorMesmoPonto = daAnterior.filter((v) => v.dataAssinatura! <= limite).length;
		}
	}

	return {
		gestao,
		gestaoAnterior: idsDeGestao().includes(ant) ? ant : null,
		fechados,
		totalGestao: daGestao.length,
		anteriorMesmoPonto,
		valorCiclo: calcularKPIsVendas(vendasDoCiclo(vendas, gestao, ciclo), null).totalVendido,
		ciclo: buscarGestao(gestao).ciclos.find((c) => c.id === ciclo)!.rotulo,
		mediaPorSemana:
			daGestao.length /
			Math.max(1, (hoje.getTime() - janelaGestao(gestao).inicio.getTime()) / (7 * 86_400_000)),
	};
}

// ─── Metas ────────────────────────────────────────────────────────

const NOMES_MES: Record<string, string> = {
	"01": "janeiro", "02": "fevereiro", "03": "março", "04": "abril",
	"05": "maio", "06": "junho", "07": "julho", "08": "agosto",
	"09": "setembro", "10": "outubro", "11": "novembro", "12": "dezembro",
};

const SEMANA_MS = 7 * 86_400_000;

function montarMetas(
	vendas: Venda[],
	cards: CardComHistorico[],
	metas: MetaPeriodo[],
	metasFaturamento: MetaPeriodo[],
	faturamento: FaturamentoMes[],
	gestao: PeriodoGestao,
	ciclo: PeriodoCiclo,
	hoje: Date,
): TvMetas {
	const daGestao = vendas.filter((v) => v.gestao === gestao && v.assinado);
	// Só a linha da Fluxo inteira; as abas por coordenação ficam para outra tela.
	const fat = new Map(
		faturamento
			.filter((f) => f.gestao === gestao && f.coordenacao === null)
			.map((f) => [f.mes.slice(5, 7), f]),
	);
	const hojeBr = diaBrasil(hoje);
	const mesHoje = hojeBr.slice(5, 7);
	// Dia 0 do mês seguinte = último dia deste.
	const diasNoMes = new Date(Number(hojeBr.slice(0, 4)), Number(mesHoje), 0).getDate();
	const meta = (lista: MetaPeriodo[], sel: SelecaoPeriodo) => metaDoPeriodo(lista, sel)?.metaVendas ?? null;

	const mesesCiclo = mesesDoCicloDaGestao(ciclo, gestao);
	const meses = mesesCiclo.map((mm) => ({
		nome: NOMES_MES[mm],
		abrev: NOMES_MES[mm].slice(0, 3),
		vendido: calcularKPIsVendas(daGestao.filter((v) => v.mes === mm), null).totalVendido,
		metaVendas: meta(metas, { gestao, tipo: "mes", mes: mm }),
		faturado: fat.get(mm)?.realizado ?? null,
		previsto: fat.get(mm)?.previsto ?? null,
		metaFaturamento: meta(metasFaturamento, { gestao, tipo: "mes", mes: mm }),
	}));

	const janela = janelaCiclo(ciclo, gestao);
	const total = janela.fim.getTime() - janela.inicio.getTime();
	const decorrido = Math.min(Math.max(hoje.getTime() - janela.inicio.getTime(), 0), total);
	const vendidoCiclo = meses.reduce((s, m) => s + m.vendido, 0);
	const metaVendasCiclo = meta(metas, { gestao, tipo: "ciclo", ciclo });
	const semanasRestantes = (total - decorrido) / SEMANA_MS;

	return {
		ciclo: buscarGestao(gestao).ciclos.find((c) => c.id === ciclo)!.rotulo,
		semana: Math.max(1, Math.ceil(decorrido / SEMANA_MS)),
		semanas: Math.ceil(total / SEMANA_MS),
		faltamDias: Math.ceil((total - decorrido) / 86_400_000),
		hojeNoMes: Number(hojeBr.slice(8, 10)) / diasNoMes,
		meses,
		mesAtual: Math.max(0, mesesCiclo.indexOf(mesHoje)),
		vendidoCiclo,
		metaVendasCiclo,
		metaFaturamentoCiclo: meta(metasFaturamento, { gestao, tipo: "ciclo", ciclo }),
		ritmoSemana: vendidoCiclo / Math.max(1, decorrido / SEMANA_MS),
		precisaSemana:
			metaVendasCiclo === null
				? null
				: Math.max(0, metaVendasCiclo - vendidoCiclo) / Math.max(1, semanasRestantes),
		propostasAbertas: cards
			.filter((c) => EM_PROPOSTA.has(c.etapa_atual))
			.reduce((s, c) => s + (c.valor_contrato ?? 0), 0),
	};
}

// ─── Entregas ─────────────────────────────────────────────────────

function gestaoDaData(iso: string): string {
	const ano = Number(iso.slice(2, 4));
	const ini = Number(iso.slice(5, 7)) >= 10 ? ano : ano - 1;
	return `${String(ini).padStart(2, "0")}/${String(ini + 1).padStart(2, "0")}`;
}

function montarEntregas(
	projetos: ProjetoEntrega[],
	gestao: PeriodoGestao,
	ciclo: PeriodoCiclo,
	hoje: Date,
	fotos: Map<string, string>,
	resolver: ResolverPessoa,
): TvEntregas {
	const hojeBr = diaBrasil(hoje);
	const entregas = projetos
		// Rescindido está na aba de entregues, mas não foi entregue.
		.filter((p) => p.estado === "entregue" && (p.situacao ?? "").trim().toLowerCase() !== "rescindido")
		.map((p) => {
			// Data no futuro não é entrega feita. A gestão sai da DATA, nunca de
			// "Gestão - Entrega": a fórmula dessa coluna não é confiável.
			const data = p.data_entrega && p.data_entrega <= hojeBr ? p.data_entrega : null;
			return {
				projeto: p.nome_projeto,
				coordenacao: p.coordenacao,
				equipe: p.tamanho_equipe,
				pessoas: p.equipe.map((n) => {
					const nome = resolver(n, data ? gestaoDaData(data) : null);
					// Fora da base de pessoas o nome vem inteiro ("Fabricio Natil
					// Martins Moreira"): na TV, primeiro e último.
					const partes = nome.split(/\s+/);
					return pessoaTv(partes.length > 2 ? `${partes[0]} ${partes[partes.length - 1]}` : nome, fotos);
				}),
				gestao: data ? gestaoDaData(data) : null,
				data,
				diasAtras: data ? Math.round((Date.parse(hojeBr) - Date.parse(data)) / 86_400_000) : null,
			};
		});

	const anterior = gestaoAnterior(gestao);
	const janela = janelaCiclo(ciclo, gestao);
	return {
		gestao,
		gestaoAnterior: anterior,
		// Sem data não se sabe quando nem em que gestão: fica fora da tela.
		entregas: entregas
			.filter((e): e is TvEntrega => e.data !== null)
			.sort((a, b) => b.data.localeCompare(a.data))
			.slice(0, 4),
		totalGestao: entregas.filter((e) => e.gestao === gestao).length,
		totalAnterior: entregas.filter((e) => e.gestao === anterior).length,
		noCiclo: entregas.filter((e) => e.data && e.data >= janela.inicioISO.slice(0, 10) && e.data <= janela.fimISO.slice(0, 10)).length,
		ciclo: buscarGestao(gestao).ciclos.find((c) => c.id === ciclo)!.rotulo,
		emExecucao: projetos.filter((p) => p.estado === "em_execucao").length,
	};
}

// ─── Montagem ─────────────────────────────────────────────────────

export interface FontesTv {
	metas: MetaPeriodo[];
	metasFaturamento: MetaPeriodo[];
	faturamento: FaturamentoMes[];
	entregas?: ProjetoEntrega[];
	/** Grafia → nome de exibição (src/lib/pessoas.ts), para a equipe das entregas. */
	resolver?: ResolverPessoa;
}

export function montarTv(
	vendas: Venda[],
	cards: CardComHistorico[],
	hoje: Date = new Date(),
	/** nome de exibição → foto_url. O ranking já vem com nomes resolvidos. */
	fotos: Map<string, string> = new Map(),
	fontes: FontesTv = { metas: [], metasFaturamento: [], faturamento: [] },
): TvData {
	const gestao = gestaoAtual(hoje);
	const ciclo = cicloVigente(gestao, hoje);
	const gestoes = idsDeGestao();

	const metas = montarMetas(
		vendas,
		cards,
		fontes.metas,
		fontes.metasFaturamento,
		fontes.faturamento,
		gestao,
		ciclo,
		hoje,
	);

	const funil = montarFunil(cards, vendas, gestao, ciclo, hoje);
	const rankingGestao = montarRanking(
		vendas.filter((v) => v.gestao === gestao),
		`acumulado da gestão ${gestao}`,
		fotos,
	);
	const rankingHistorico = montarRanking(
		vendas,
		`histórico ${gestoes[0]}–${gestoes[gestoes.length - 1]}`,
		fotos,
	);
	const fechados = montarFechados(vendas, gestao, ciclo, hoje, fotos);
	const entregas = montarEntregas(fontes.entregas ?? [], gestao, ciclo, hoje, fotos, fontes.resolver ?? ((n) => n));

	const telas: TelaTv[] = [];
	// Sem faturamento a tela perde metade (e o gráfico inteiro): fica fora.
	if (metas.meses.some((m) => m.faturado !== null || m.previsto !== null)) telas.push("metas");
	if (funil.etapas[0].quantidade > 0) telas.push("funil");
	if (rankingGestao.vendedores.length > 0) telas.push("ranking-gestao");
	if (rankingHistorico.vendedores.length > 0) telas.push("ranking-historico");
	if (fechados.fechados.length > 0) telas.push("fechados");
	if (entregas.entregas.length > 0) telas.push("entregas");

	return {
		gestao,
		ciclo: funil.ciclo,
		telas,
		metas,
		funil,
		rankingGestao,
		rankingHistorico,
		fechados,
		entregas,
	};
}
