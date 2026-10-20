// src/lib/snapshots/ler.ts
//
// Lê o congelado e confronta com a fonte de hoje.

import { createClient } from "@supabase/supabase-js";

import { MetaPeriodo, Venda } from "@/types";
import { SelecaoPeriodo } from "@/lib/metas-periodo";
import {
	MetricasCongeladas,
	calcularMetricasCongeladas,
	hashMetricas,
} from "./metricas";
import { vendasDoPeriodo } from "./congelar";

export interface Snapshot {
	idSnapshot: number;
	gestao: string;
	tipoPeriodo: "gestao" | "ciclo" | "mes";
	periodo: string;
	metricas: MetricasCongeladas;
	hashMetricas: string;
	versaoCalculo: number;
	geradoEm: string;
}

function getSupabase() {
	return createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
}

function chaveDoPeriodo(sel: SelecaoPeriodo): string {
	if (sel.tipo === "ciclo") return sel.ciclo ?? "";
	if (sel.tipo === "mes") return (sel.mes ?? "").padStart(2, "0");
	return sel.gestao;
}

function paraSnapshot(row: Record<string, unknown>): Snapshot {
	return {
		idSnapshot: row.id_snapshot as number,
		gestao: row.gestao as string,
		tipoPeriodo: row.tipo_periodo as Snapshot["tipoPeriodo"],
		periodo: row.periodo as string,
		metricas: row.metricas as MetricasCongeladas,
		hashMetricas: row.hash_metricas as string,
		versaoCalculo: row.versao_calculo as number,
		geradoEm: row.gerado_em as string,
	};
}

/**
 * O snapshot que a tela deve mostrar, ou `null` se o período não foi congelado.
 *
 * Devolve o de MENOR `versao_calculo` — o ORIGINAL, não o mais recente.
 *
 * A escolha é deliberada e vale a pena entender: se uma regra de cálculo mudar e
 * o período for recongelado numa versão nova, mostrar a versão nova reescreveria
 * o número que já foi apresentado — exatamente o que a F7 existe para impedir.
 * O congelado original é o que foi reportado; a versão nova é uma correção, e
 * correção se ANUNCIA, não se aplica por baixo. `recalculoDisponivel` sinaliza
 * que ela existe, e aí a decisão de restabelecer o número é de quem responde por
 * ele, não do código.
 */
export async function buscarSnapshot(
	sel: SelecaoPeriodo,
): Promise<{ snapshot: Snapshot | null; recalculoDisponivel: number | null }> {
	const { data, error } = await getSupabase()
		.from("snapshot_periodo")
		.select("*")
		.eq("gestao", sel.gestao)
		.eq("tipo_periodo", sel.tipo)
		.eq("periodo", chaveDoPeriodo(sel))
		.eq("escopo", "geral")
		.order("versao_calculo", { ascending: true });

	if (error || !data || data.length === 0) {
		// Tabela ausente (migration 0006 não aplicada) e período não congelado dão
		// o mesmo resultado prático — a tela calcula ao vivo, que é o que fazia
		// antes da F7. Só o erro merece log.
		if (error) console.warn(`[Snapshot] Leitura falhou: ${error.message}`);
		return { snapshot: null, recalculoDisponivel: null };
	}

	return {
		snapshot: paraSnapshot(data[0]),
		recalculoDisponivel:
			data.length > 1 ? (data[data.length - 1].versao_calculo as number) : null,
	};
}

// ─── Confronto com a fonte de hoje ────────────────────────────────

export interface DiferencaMetrica {
	campo: string;
	congelado: number | boolean;
	agora: number | boolean;
}

export interface Divergencia {
	/** O JSON guardado ainda corresponde ao seu próprio hash? */
	hashConfere: boolean;
	/** Recalcular hoje, com a MESMA versão, dá o mesmo resultado? */
	diferencas: DiferencaMetrica[];
}

function achatar(m: MetricasCongeladas): Record<string, number | boolean> {
	const plano: Record<string, number | boolean> = {
		totalVendido: m.totalVendido,
		numeroDeVendas: m.numeroDeVendas,
		ticketMedio: m.ticketMedio,
		metaDefinida: m.metaDefinida,
		metaVendas: m.metaVendas,
		percentualMeta: m.percentualMeta,
	};
	for (const c of m.porCoordenacao ?? []) {
		plano[`${c.coordenacao}.totalVendido`] = c.totalVendido;
		plano[`${c.coordenacao}.numeroDeVendas`] = c.numeroDeVendas;
		plano[`${c.coordenacao}.metaVendas`] = c.metaVendas;
	}
	for (const c of m.porCanal ?? []) {
		plano[`canal:${c.canal}.totalVendido`] = c.totalVendido;
		plano[`canal:${c.canal}.numeroDeVendas`] = c.numeroDeVendas;
	}
	for (const v of m.porVendedor ?? []) {
		plano[`vendedor:${v.responsavel}.totalVendido`] = v.totalVendido;
		plano[`vendedor:${v.responsavel}.numeroDeVendas`] = v.numeroDeVendas;
	}
	for (const x of m.porMes ?? []) {
		plano[`mes:${x.mes}.totalVendido`] = x.totalVendido;
		plano[`mes:${x.mes}.numeroDeVendas`] = x.numeroDeVendas;
	}
	return plano;
}

/**
 * Compara o congelado com o que a fonte diria HOJE.
 *
 * Duas perguntas diferentes, e a distinção é o valor inteiro desta função:
 *
 *   `hashConfere` falso  → o JSON guardado foi ALTERADO por fora. O gatilho da
 *      0006 recusa UPDATE, então isto significa acesso direto ao banco, restore
 *      de dump ou migração mal feita. É adulteração, não divergência.
 *
 *   `diferencas` não vazio → a FONTE mudou depois do congelamento. Legítimo
 *      (correção de contrato) ou não (cron gravando lixo), mas em ambos os casos
 *      alguém precisa saber: o número na tela deixou de ser o número da planilha.
 *
 * Só compara snapshot da MESMA versão de cálculo — entre versões diferentes a
 * diferença é esperada e comparar seria produzir alarme por mudança de regra.
 */
export function compararComAFonte(
	snapshot: Snapshot,
	versaoAtual: number,
	todasVendas: Venda[],
	todasMetas: MetaPeriodo[],
): Divergencia | null {
	if (snapshot.versaoCalculo !== versaoAtual) return null;

	const sel: SelecaoPeriodo = {
		gestao: snapshot.gestao,
		tipo: snapshot.tipoPeriodo,
		ciclo: snapshot.tipoPeriodo === "ciclo" ? snapshot.periodo : undefined,
		mes: snapshot.tipoPeriodo === "mes" ? snapshot.periodo : undefined,
	};

	const agora = calcularMetricasCongeladas(
		vendasDoPeriodo(todasVendas, sel),
		todasMetas,
		sel,
	);

	const a = achatar(snapshot.metricas);
	const b = achatar(agora);
	const campos = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();

	const diferencas: DiferencaMetrica[] = [];
	for (const campo of campos) {
		const congelado = a[campo] ?? 0;
		const atual = b[campo] ?? 0;
		if (congelado !== atual) diferencas.push({ campo, congelado, agora: atual });
	}

	return {
		hashConfere: hashMetricas(snapshot.metricas) === snapshot.hashMetricas,
		diferencas,
	};
}
