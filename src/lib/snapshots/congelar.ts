// src/lib/snapshots/congelar.ts
//
// Decide o que já pode ser congelado e grava.

import { createClient } from "@supabase/supabase-js";

import { MetaPeriodo, Venda } from "@/types";
import { GESTOES } from "@/lib/fontes/registry";
import { MESES_DA_GESTAO } from "@/lib/fontes/calendario";
import { janelaCiclo, janelaGestao, janelaMes } from "@/lib/periodo-gestao";
import { porCiclo, porGestao, porMes } from "@/lib/calculations";
import { SelecaoPeriodo } from "@/lib/metas-periodo";
import {
	MetricasCongeladas,
	VERSAO_CALCULO,
	calcularMetricasCongeladas,
	hashMetricas,
} from "./metricas";

/**
 * Quantos meses cheios precisam passar depois do fim do período.
 *
 * 1 = a regra é "um período só congela quando o mês SEGUINTE ao fim dele acaba".
 *
 * NÃO é um contador de dias, e a diferença não é preciosismo: janeiro mais 30
 * dias cai em 2 de março, dois dias depois de fevereiro ter terminado, e a
 * fronteira passa a depender do tamanho do mês. Alinhar ao calendário dá uma
 * regra que se explica numa frase — e regra que se explica numa frase não vira
 * discussão sobre se deviam ser 30 ou 45 dias.
 *
 * O prazo existe porque contrato assinado no fim do mês entra na planilha
 * depois. Um mês inteiro de folga cobre isso com sobra.
 *
 * A versão anterior usava 90 dias, herdados de `LIMIAR_MATURACAO_DIAS` (funil).
 * Lá o prazo espera o CARD percorrer o funil; aqui espera o CONTRATO chegar na
 * planilha. São coisas diferentes e o número foi copiado sem ser escolhido.
 */
export const MESES_DE_CARENCIA = 1;

const OFFSET_BRASIL = "-03:00";
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * A partir de quando o período pode ser congelado.
 *
 * Último instante do mês que fica `MESES_DE_CARENCIA` meses depois daquele em
 * que o período terminou. Ancorado em Brasília, como todo o resto do projeto.
 */
export function liberadoAPartirDe(fimDoPeriodo: Date): Date {
	// Componentes em BRT, não em UTC: 30/06 23:59:59.999 BRT é 01/07 02:59 UTC,
	// e ler o mês em UTC devolveria julho — a carência sairia um mês curta.
	const emBrasilia = new Date(fimDoPeriodo.getTime() - 3 * 60 * 60 * 1000);
	const ano = emBrasilia.getUTCFullYear();
	const mes = emBrasilia.getUTCMonth() + 1; // 1-base

	const alvo = mes + MESES_DE_CARENCIA;
	const anoAlvo = ano + Math.floor((alvo - 1) / 12);
	const mesAlvo = ((alvo - 1) % 12) + 1;

	// Dia 0 do mês seguinte = último dia do mês alvo.
	const ultimoDia = new Date(Date.UTC(anoAlvo, mesAlvo, 0)).getUTCDate();
	return new Date(
		`${anoAlvo}-${pad2(mesAlvo)}-${pad2(ultimoDia)}T23:59:59.999${OFFSET_BRASIL}`,
	);
}

const DIA_MS = 24 * 60 * 60 * 1000;

export interface PeriodoCongelavel {
	sel: SelecaoPeriodo;
	/** Rótulo legível, para o relatório do script. */
	rotulo: string;
	fim: Date;
	diasDesdeOFim: number;
}

/**
 * Todo período do registry que já fechou e passou a carência.
 *
 * Enumera gestão, ciclos e meses. Um mês fechado de uma gestão ainda EM CURSO
 * também entra: o mês acabou, a carência passou, e não há motivo para deixá-lo
 * exposto a reescrita só porque o ano ainda não terminou.
 */
export function periodosCongelaveis(
	agora: Date = new Date(),
): PeriodoCongelavel[] {
	const fora: PeriodoCongelavel[] = [];

	const considerar = (sel: SelecaoPeriodo, rotulo: string, fim: Date) => {
		if (agora.getTime() < liberadoAPartirDe(fim).getTime()) return;
		const dias = Math.floor((agora.getTime() - fim.getTime()) / DIA_MS);
		fora.push({ sel, rotulo, fim, diasDesdeOFim: dias });
	};

	for (const g of GESTOES) {
		considerar(
			{ gestao: g.id, tipo: "gestao" },
			`gestão ${g.id}`,
			janelaGestao(g.id).fim,
		);

		for (const c of g.ciclos) {
			considerar(
				{ gestao: g.id, tipo: "ciclo", ciclo: c.id },
				`${g.id} · ${c.rotulo}`,
				janelaCiclo(c.id, g.id).fim,
			);
		}

		for (const mes of MESES_DA_GESTAO) {
			considerar(
				{ gestao: g.id, tipo: "mes", mes },
				`${g.id} · mês ${mes}`,
				janelaMes(mes, g.id).fim,
			);
		}
	}

	return fora;
}

function getSupabase() {
	return createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
}

/** Recorta as vendas do período — mesma regra da tela. */
export function vendasDoPeriodo(todas: Venda[], sel: SelecaoPeriodo): Venda[] {
	const daGestao = porGestao(todas, sel.gestao);
	if (sel.tipo === "ciclo" && sel.ciclo)
		return porCiclo(daGestao, sel.ciclo, sel.gestao);
	if (sel.tipo === "mes" && sel.mes) return porMes(daGestao, sel.mes);
	return daGestao;
}

export interface ResultadoCongelamento {
	criados: { rotulo: string; hash: string }[];
	jaExistiam: string[];
	/** Período fechado que não tem venda nenhuma: não se congela o vazio. */
	semDados: string[];
	erros: { rotulo: string; motivo: string }[];
}

/**
 * Congela todo período elegível que ainda não tem snapshot NESTA versão.
 *
 * Idempotente: rodar duas vezes seguidas não cria nada na segunda. Nunca
 * sobrescreve — a tabela recusa UPDATE por gatilho, então uma tentativa de
 * recongelar aparece como erro, não como número trocado por baixo.
 */
export async function congelarPeriodos(params: {
	vendas: Venda[];
	metas: MetaPeriodo[];
	idExecucao?: number | null;
	agora?: Date;
}): Promise<ResultadoCongelamento> {
	const supabase = getSupabase();
	const r: ResultadoCongelamento = {
		criados: [],
		jaExistiam: [],
		semDados: [],
		erros: [],
	};

	const { data: existentes, error: erroLeitura } = await supabase
		.from("snapshot_periodo")
		.select("gestao, tipo_periodo, periodo, escopo")
		.eq("versao_calculo", VERSAO_CALCULO);

	if (erroLeitura) {
		r.erros.push({
			rotulo: "(leitura de snapshots existentes)",
			motivo: `${erroLeitura.message}. Aplicou a migration 0006?`,
		});
		return r;
	}

	const chave = (s: SelecaoPeriodo) =>
		`${s.gestao}|${s.tipo}|${s.tipo === "ciclo" ? s.ciclo : s.tipo === "mes" ? s.mes : s.gestao}|geral`;
	const jaTem = new Set(
		(existentes ?? []).map(
			(e) => `${e.gestao}|${e.tipo_periodo}|${e.periodo}|${e.escopo}`,
		),
	);

	for (const p of periodosCongelaveis(params.agora)) {
		if (jaTem.has(chave(p.sel))) {
			r.jaExistiam.push(p.rotulo);
			continue;
		}

		const vendas = vendasDoPeriodo(params.vendas, p.sel);
		if (vendas.length === 0) {
			// Congelar zero seria afirmar "este período fechou sem nenhuma venda".
			// Pode ser verdade — ou pode ser que a fonte daquele período nunca foi
			// carregada. As duas coisas produzem a mesma lista vazia, e sem como
			// distinguir a resposta honesta é não afirmar nada.
			r.semDados.push(p.rotulo);
			continue;
		}

		const metricas: MetricasCongeladas = calcularMetricasCongeladas(
			vendas,
			params.metas,
			p.sel,
		);
		const hash = hashMetricas(metricas);

		const { error } = await supabase.from("snapshot_periodo").insert({
			gestao: p.sel.gestao,
			tipo_periodo: p.sel.tipo,
			periodo:
				p.sel.tipo === "ciclo"
					? p.sel.ciclo
					: p.sel.tipo === "mes"
						? p.sel.mes
						: p.sel.gestao,
			escopo: "geral",
			metricas,
			hash_metricas: hash,
			versao_calculo: VERSAO_CALCULO,
			id_execucao: params.idExecucao ?? null,
		});

		if (error) r.erros.push({ rotulo: p.rotulo, motivo: error.message });
		else r.criados.push({ rotulo: p.rotulo, hash });
	}

	return r;
}
