// src/lib/auditoria/coletar.ts
//
// Reúne o estado de saúde da ingestão para a tela de auditoria (F8).
//
// Tudo isto já existia — em `scripts/auditar-banco.ts`, que só quem tem o
// terminal aberto roda. A F8 leva para a tela porque a pergunta "posso confiar
// neste número?" é de quem LÊ o dash, não de quem mantém o código.

import { createClient } from "@supabase/supabase-js";

import { GESTOES } from "@/lib/fontes/registry";
import { todosOsPipes } from "@/lib/fontes/pipes";
import { COBERTURAS } from "@/lib/fontes/cobertura";

function getSupabase() {
	return createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
}

/** Nome legível de uma fonte a partir do id cru. */
export function nomeDaFonte(fonteRef: string): string {
	const pipe = todosOsPipes().find((p) => p.pipeId === fonteRef);
	if (pipe) return `Pipefy · ${pipe.nome}`;

	const g = GESTOES.find(
		(x) =>
			x.contratos.spreadsheetId === fonteRef ||
			x.metas?.spreadsheetId === fonteRef,
	);
	if (g) return `Planilha ${g.id}`;

	return fonteRef;
}

export interface ExecucaoResumo {
	idExecucao: number;
	fonteRef: string;
	fonteNome: string;
	status: string;
	disparadoPor: string;
	iniciadoEm: string;
	terminadoEm: string | null;
	lidas: number;
	aceitas: number;
	rejeitadas: number;
	ignoradas: number;
	removidas: number;
	erro: string | null;
}

/**
 * Uma pendência = um problema, não uma ocorrência.
 *
 * A tabela `ingestao_rejeicao` guarda um registro POR RODADA: os mesmos "???"
 * da planilha de 25/26 viram uma linha nova a cada carga, e em duas semanas
 * eram 127 registros para 12 problemas. Uma lista com 127 itens não é lista de
 * pendências, é ruído — e ruído ensina a não olhar.
 *
 * Agrupando por (origem, motivo), o que aparece é o problema, e a primeira
 * ocorrência vira a informação mais útil da tela: há quanto tempo ele está lá.
 */
export interface Pendencia {
	origemRef: string;
	/** Nome legível da fonte, para a coluna não repetir o id cru da planilha. */
	fonteNome: string;
	/** A parte do `origemRef` que localiza a célula: "Contratos · L33". */
	local: string;
	motivo: string;
	campo: string | null;
	ocorrencias: number;
	primeiraEm: string;
	ultimaEm: string;
	payload: unknown;
}

export interface CoberturaResumo {
	fonteTipo: string;
	fonteRef: string;
	fonteNome: string;
	gestao: string | null;
	inicioReal: string;
	fimReal: string | null;
	observacao: string | null;
	/** A declaração em código bate com o que está gravado? */
	confereComOCodigo: boolean;
}

export interface SnapshotResumo {
	idSnapshot: number;
	gestao: string;
	tipoPeriodo: string;
	periodo: string;
	versaoCalculo: number;
	geradoEm: string;
	totalVendido: number;
	numeroDeVendas: number;
}

/**
 * Duas séries de meta que não batem — e não deviam bater.
 *
 * A meta da gestão vem da linha "total" do bloco mensal. O bloco por
 * coordenação soma outro valor — em 25/26, a diferença passa de 25%.
 * Divergir é ESPERADO (são recortes diferentes do planejamento), e é
 * exatamente por isso que precisa ficar visível: alguém que compare os dois
 * sem saber disso vai concluir que o dash está errado.
 */
export interface DivergenciaMeta {
	gestao: string;
	metaGeral: number;
	somaPorCoordenacao: number;
	diferenca: number;
}

export interface EstadoAuditoria {
	execucoes: ExecucaoResumo[];
	pendencias: Pendencia[];
	cobertura: CoberturaResumo[];
	snapshots: SnapshotResumo[];
	divergenciaMetas: DivergenciaMeta[];
	/** O que não pôde ser lido — nunca some em silêncio. */
	indisponivel: string[];
}

/**
 * Quebra "<id>#<aba>#L33" em fonte legível e localização.
 *
 * O id da planilha tem 44 caracteres e é o mesmo em toda linha da lista — repetir
 * isso em cada pendência empurra para fora da tela justamente o que localiza o
 * problema. O id continua no atributo `title`, para quem precisar dele.
 */
export function quebrarOrigem(origemRef: string): {
	fonteNome: string;
	local: string;
} {
	const partes = origemRef.split("#");
	if (partes.length < 2) return { fonteNome: nomeDaFonte(origemRef), local: "" };
	return {
		fonteNome: nomeDaFonte(partes[0]),
		local: partes.slice(1).join(" · "),
	};
}

/** Linha de `ingestao_rejeicao` como o banco devolve. */
export interface RejeicaoGravada {
	id_execucao: number;
	origem_ref: string;
	motivo: string;
	campo: string | null;
	payload_bruto: unknown;
	criado_em: string;
}

/** Ids das planilhas que o registry lê (contratos e metas, sem repetir). */
function idsDePlanilhas(): string[] {
	return [
		...new Set(
			GESTOES.flatMap((g) =>
				[g.contratos.spreadsheetId, g.metas?.spreadsheetId].filter(
					(x): x is string => Boolean(x),
				),
			),
		),
	];
}

/**
 * Agrupa rejeições em pendências e descarta as que já foram resolvidas.
 *
 * `ingestao_rejeicao` é histórico: cada rodada grava as suas e nada nunca as
 * apaga. Listar tudo fazia a auditoria acusar, semanas depois, linhas que o time
 * já tinha corrigido na planilha ("sem valor" em linhas hoje preenchidas) — uma
 * tela que afirma um problema que não existe ensina a ignorar a que importa.
 *
 * Planilha é lida POR INTEIRO a cada rodada, então a última carga bem-sucedida é
 * a resposta completa sobre o estado atual: o que ela não rejeitou, está
 * resolvido. A pendência continua trazendo o histórico (quantas vezes, desde
 * quando) — mas só aparece enquanto o problema está na última carga.
 *
 * Outras fontes (Pipefy) ficam como estavam: a leitura é incremental e só
 * reprocessa o que mudou, então a ausência numa rodada não prova correção.
 * Planilha sem nenhuma carga bem-sucedida também fica: sem régua, não se esconde.
 */
export function agruparPendencias(
	rejeicoes: RejeicaoGravada[],
	ultimaOkPorPlanilha: Map<string, number>,
): Pendencia[] {
	const mapa = new Map<string, Pendencia>();
	const naUltimaCarga = new Set<string>();

	for (const r of rejeicoes) {
		const planilha = r.origem_ref.split("#")[0];
		const chave = `${r.origem_ref}|${r.motivo}`;
		if (ultimaOkPorPlanilha.get(planilha) === r.id_execucao) {
			naUltimaCarga.add(chave);
		}
		const atual = mapa.get(chave);
		if (atual) {
			atual.ocorrencias += 1;
			atual.ultimaEm = r.criado_em;
		} else {
			const { fonteNome, local } = quebrarOrigem(r.origem_ref);
			mapa.set(chave, {
				origemRef: r.origem_ref,
				fonteNome,
				local,
				motivo: r.motivo,
				campo: r.campo,
				ocorrencias: 1,
				primeiraEm: r.criado_em,
				ultimaEm: r.criado_em,
				payload: r.payload_bruto,
			});
		}
	}

	return (
		[...mapa.entries()]
			.filter(
				([chave, p]) =>
					naUltimaCarga.has(chave) ||
					!ultimaOkPorPlanilha.has(p.origemRef.split("#")[0]),
			)
			.map(([, p]) => p)
			// Mais antigas primeiro: pendência que resiste há semanas é a que interessa.
			.sort(
				(a, b) =>
					new Date(a.primeiraEm).getTime() - new Date(b.primeiraEm).getTime(),
			)
	);
}

export async function coletarAuditoria(): Promise<EstadoAuditoria> {
	const supabase = getSupabase();
	const indisponivel: string[] = [];

	// ── Última execução de cada fonte ────────────────────────────
	const execucoes: ExecucaoResumo[] = [];
	const resExec = await supabase
		.from("ingestao_execucao")
		.select("*")
		.neq("status", "executando")
		.order("id_execucao", { ascending: false })
		.limit(500);

	if (resExec.error) {
		indisponivel.push(`execuções: ${resExec.error.message}`);
	} else {
		const vistas = new Set<string>();
		for (const e of resExec.data ?? []) {
			if (vistas.has(e.fonte_ref)) continue;
			vistas.add(e.fonte_ref);
			execucoes.push({
				idExecucao: e.id_execucao,
				fonteRef: e.fonte_ref,
				fonteNome: nomeDaFonte(e.fonte_ref),
				status: e.status,
				disparadoPor: e.disparado_por,
				iniciadoEm: e.iniciado_em,
				terminadoEm: e.terminado_em,
				lidas: e.linhas_lidas,
				aceitas: e.linhas_aceitas,
				rejeitadas: e.linhas_rejeitadas,
				ignoradas: e.linhas_ignoradas,
				removidas: e.linhas_removidas,
				erro: e.erro,
			});
		}
		execucoes.sort((a, b) => a.fonteNome.localeCompare(b.fonteNome, "pt-BR"));
	}

	// ── Pendências (rejeições agrupadas) ─────────────────────────
	const pendencias: Pendencia[] = [];
	const rejeicoes: RejeicaoGravada[] = [];
	let erroRejeicoes: string | null = null;

	// Pagina: o PostgREST corta a resposta em 1000 linhas e, com o corte
	// ascendente que havia aqui, as rejeições MAIS NOVAS seriam as que ficavam de
	// fora — justamente as que dizem se o problema ainda existe.
	for (let inicio = 0; ; inicio += 1000) {
		const { data, error } = await supabase
			.from("ingestao_rejeicao")
			.select("id_execucao, origem_ref, motivo, campo, payload_bruto, criado_em")
			.order("id_rejeicao", { ascending: true })
			.range(inicio, inicio + 999);
		if (error) {
			erroRejeicoes = error.message;
			break;
		}
		rejeicoes.push(...(data ?? []));
		if ((data?.length ?? 0) < 1000) break;
	}

	if (erroRejeicoes) {
		indisponivel.push(`rejeições: ${erroRejeicoes}`);
	} else {
		// Última carga bem-sucedida de cada planilha — a régua que diz se uma
		// rejeição antiga ainda vale.
		const ultimaOkPorPlanilha = new Map<string, number>();
		for (const ref of idsDePlanilhas()) {
			const { data, error } = await supabase
				.from("ingestao_execucao")
				.select("id_execucao")
				.eq("fonte_tipo", "sheets")
				.eq("fonte_ref", ref)
				.eq("status", "ok")
				.order("id_execucao", { ascending: false })
				.limit(1);
			if (error) {
				indisponivel.push(`última carga da planilha: ${error.message}`);
				continue;
			}
			if (data?.[0]) ultimaOkPorPlanilha.set(ref, data[0].id_execucao);
		}
		pendencias.push(...agruparPendencias(rejeicoes, ultimaOkPorPlanilha));
	}

	// ── Cobertura ────────────────────────────────────────────────
	const cobertura: CoberturaResumo[] = [];
	const resCob = await supabase.from("cobertura_fonte").select("*");
	if (resCob.error) {
		indisponivel.push(`cobertura: ${resCob.error.message}`);
	} else {
		for (const c of resCob.data ?? []) {
			const declarada = COBERTURAS.find(
				(d) =>
					d.fonteTipo === c.fonte_tipo &&
					d.fonteRef === c.fonte_ref &&
					(d.gestao ?? null) === c.gestao,
			);
			cobertura.push({
				fonteTipo: c.fonte_tipo,
				fonteRef: c.fonte_ref,
				fonteNome: nomeDaFonte(c.fonte_ref),
				gestao: c.gestao,
				inicioReal: c.inicio_real,
				fimReal: c.fim_real,
				observacao: c.observacao,
				// Banco e código podem separar-se: alguém edita a tabela à mão, ou o
				// código muda e ninguém roda `registrar-cobertura`.
				confereComOCodigo:
					!!declarada &&
					new Date(declarada.inicioISO).getTime() ===
						new Date(c.inicio_real).getTime() &&
					(declarada.fimISO === null) === (c.fim_real === null),
			});
		}
		cobertura.sort((a, b) => a.fonteNome.localeCompare(b.fonteNome, "pt-BR"));
	}

	// ── Snapshots ────────────────────────────────────────────────
	const snapshots: SnapshotResumo[] = [];
	const resSnap = await supabase
		.from("snapshot_periodo")
		.select(
			"id_snapshot, gestao, tipo_periodo, periodo, versao_calculo, gerado_em, metricas",
		)
		.order("gestao", { ascending: true });

	if (resSnap.error) {
		indisponivel.push(`snapshots: ${resSnap.error.message}`);
	} else {
		for (const s of resSnap.data ?? []) {
			const m = s.metricas as { totalVendido: number; numeroDeVendas: number };
			snapshots.push({
				idSnapshot: s.id_snapshot,
				gestao: s.gestao,
				tipoPeriodo: s.tipo_periodo,
				periodo: s.periodo,
				versaoCalculo: s.versao_calculo,
				geradoEm: s.gerado_em,
				totalVendido: m?.totalVendido ?? 0,
				numeroDeVendas: m?.numeroDeVendas ?? 0,
			});
		}
	}

	// ── Divergência entre as duas séries de meta ─────────────────
	const divergenciaMetas: DivergenciaMeta[] = [];
	const resMeta = await supabase
		.from("meta")
		.select("gestao_meta, tipo_meta, coordenacao, valor_meta")
		.eq("tipo_meta", "gestao");

	if (resMeta.error) {
		indisponivel.push(`metas: ${resMeta.error.message}`);
	} else {
		for (const g of GESTOES) {
			const daGestao = (resMeta.data ?? []).filter((m) => m.gestao_meta === g.id);
			const geral = daGestao.find((m) => !m.coordenacao)?.valor_meta ?? 0;
			const soma = daGestao
				.filter((m) => m.coordenacao)
				.reduce((s, m) => s + (m.valor_meta ?? 0), 0);
			if (geral > 0 && soma > 0 && Math.round(geral) !== Math.round(soma)) {
				divergenciaMetas.push({
					gestao: g.id,
					metaGeral: geral,
					somaPorCoordenacao: soma,
					diferenca: geral - soma,
				});
			}
		}
	}

	return {
		execucoes,
		pendencias,
		cobertura,
		snapshots,
		divergenciaMetas,
		indisponivel,
	};
}
