// src/lib/snapshots/metricas.ts
//
// O que exatamente fica congelado, e como se prova que não mudou.

import { createHash } from "crypto";

import { Coordenacao, MetaPeriodo, Venda } from "@/types";
import {
	calcularKPIsPorVendedor,
	calcularKPIsVendas,
	calcularVendasPorMes,
} from "@/lib/calculations";
import {
	COORDENACOES,
	SelecaoPeriodo,
	metaDoPeriodo,
	metasPorCoordenacao,
} from "@/lib/metas-periodo";

/**
 * Versão do CÁLCULO, não do schema.
 *
 * Sobe quando a regra que produz qualquer número aqui muda — outra base de
 * conversão, outra definição de "assinado", outro tratamento de meta ausente.
 * NÃO sobe por refatoração que preserva o resultado.
 *
 * Serve para responder à pergunta certa diante de uma divergência: com a MESMA
 * versão, recalcular tem de dar igual, e diferir é bug ou fonte alterada. Entre
 * versões DIFERENTES, diferir é esperado — mudou a regra, e o congelado
 * continua sendo o que foi reportado na época.
 *
 * Histórico:
 *   1 — F7. Base do funil em Oportunidade, valor de venda em "Valor Vendido
 *       real", meta ausente sem fallback para a meta da gestão.
 *   2 — Responsável resolvido para a PESSOA (src/lib/pessoas.ts, migration
 *       0011). `porVendedor` junta grafias da mesma pessoa; antes, cada grafia
 *       era um vendedor. E, até 23/24, cada responsável leva o "Valor Vendido
 *       real" em vez do "Valor contrato" (`valorDoResponsavel`).
 */
export const VERSAO_CALCULO = 2;

export interface MetricasCongeladas {
	totalVendido: number;
	numeroDeVendas: number;
	ticketMedio: number;
	/** Distingue "não há meta" de "meta zero" — ver KPIsVendas.metaDefinida. */
	metaDefinida: boolean;
	metaVendas: number;
	percentualMeta: number;
	porCoordenacao: {
		coordenacao: Coordenacao;
		totalVendido: number;
		numeroDeVendas: number;
		metaVendas: number;
	}[];
	porCanal: { canal: string; totalVendido: number; numeroDeVendas: number }[];
	porVendedor: {
		responsavel: string;
		totalVendido: number;
		numeroDeVendas: number;
	}[];
	/** Na ordem da gestão (out→set), como a tela desenha. */
	porMes: { mes: string; totalVendido: number; numeroDeVendas: number }[];
}

/**
 * Arredonda antes de congelar.
 *
 * Soma de ponto flutuante depende da ORDEM das parcelas, e a ordem das vendas
 * depende da paginação do banco. Sem arredondar, dois cálculos do mesmo período
 * podem diferir na 13ª casa decimal e produzir hashes diferentes — o
 * verificador acusaria adulteração onde não houve nenhuma.
 */
function dinheiro(v: number): number {
	return Math.round(v * 100) / 100;
}
function percentual(v: number): number {
	return Math.round(v * 10000) / 10000;
}

const ASSINADA = (v: Venda) => v.assinado;

export function calcularMetricasCongeladas(
	vendasDoPeriodo: Venda[],
	todasMetas: MetaPeriodo[],
	sel: SelecaoPeriodo,
): MetricasCongeladas {
	const kpis = calcularKPIsVendas(vendasDoPeriodo, metaDoPeriodo(todasMetas, sel));
	const metasCoord = metasPorCoordenacao(todasMetas, sel);
	const assinadas = vendasDoPeriodo.filter(ASSINADA);

	// Ordem FIXA, não a de chegada: a lista entra no hash, e uma reordenação
	// inocente viraria "o snapshot foi adulterado".
	const porCoordenacao = COORDENACOES.map((coord) => {
		const doCoord = assinadas.filter((v) => v.coordenacao === coord);
		return {
			coordenacao: coord,
			totalVendido: dinheiro(
				doCoord.reduce((s, v) => s + v.valorVendidoReal, 0),
			),
			numeroDeVendas: doCoord.length,
			metaVendas: dinheiro(metasCoord[coord]),
		};
	});

	const canais = new Map<string, { total: number; n: number }>();
	for (const v of assinadas) {
		const canal = (v.canalDeAquisicao || "Não informado").trim();
		const atual = canais.get(canal) ?? { total: 0, n: 0 };
		atual.total += v.valorVendidoReal;
		atual.n += 1;
		canais.set(canal, atual);
	}

	const porCanal = [...canais.entries()]
		// Alfabética, pelo mesmo motivo da ordem fixa acima.
		.sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
		.map(([canal, x]) => ({
			canal,
			totalVendido: dinheiro(x.total),
			numeroDeVendas: x.n,
		}));

	// Ordem alfabética por nome. A de `calcularKPIsPorVendedor` é por valor, e
	// duas vendas empatadas poderiam trocar de lugar entre execuções — mudando o
	// hash sem que nenhum número tivesse mudado.
	const porVendedor = calcularKPIsPorVendedor(vendasDoPeriodo)
		.map((v) => ({
			responsavel: v.responsavel,
			totalVendido: dinheiro(v.totalVendido),
			numeroDeVendas: v.numeroDeVendas,
		}))
		.sort((a, b) => a.responsavel.localeCompare(b.responsavel, "pt-BR"));

	const porMes = calcularVendasPorMes(vendasDoPeriodo).map((m) => ({
		mes: m.mes,
		totalVendido: dinheiro(m.totalVendido),
		numeroDeVendas: m.numeroDeVendas,
	}));

	return {
		totalVendido: dinheiro(kpis.totalVendido),
		numeroDeVendas: kpis.numeroDeVendas,
		ticketMedio: dinheiro(kpis.ticketMedio),
		metaDefinida: kpis.metaDefinida,
		metaVendas: dinheiro(kpis.metaVendas),
		percentualMeta: percentual(kpis.percentualMeta),
		porCoordenacao,
		porCanal,
		porVendedor,
		porMes,
	};
}

/**
 * JSON canônico: chaves em ordem alfabética, em qualquer profundidade.
 *
 * `JSON.stringify` preserva a ordem de inserção das chaves, então o mesmo objeto
 * montado por dois caminhos diferentes geraria strings diferentes — e hashes
 * diferentes para dados idênticos.
 */
export function jsonCanonico(valor: unknown): string {
	if (valor === null || typeof valor !== "object") return JSON.stringify(valor);
	if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(",")}]`;

	const obj = valor as Record<string, unknown>;
	const pares = Object.keys(obj)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`);
	return `{${pares.join(",")}}`;
}

export function hashMetricas(m: MetricasCongeladas): string {
	return createHash("sha256").update(jsonCanonico(m)).digest("hex");
}
