// src/lib/auditoria/frescor.ts
//
// Quão velho é o dado que está na tela.
//
// O dashboard mostrava `ultimaAtualizacao: new Date()` — a hora da REQUISIÇÃO,
// não a do dado. Com o cron parado por dez horas, a tela continuava anunciando
// "atualizado agora". Não era um rótulo impreciso: era o único lugar onde a
// falha apareceria, dizendo o contrário do que acontecia.
//
// Nenhum agendador externo é confiável — o do GitHub Actions documenta que pode
// atrasar e DESCARTAR execuções em horário de pico. Não dá para garantir que a
// carga aconteça; dá para garantir que a tela diga a verdade sobre quando ela
// aconteceu pela última vez.

import { createClient } from "@supabase/supabase-js";

import { pipesDoCron } from "@/lib/fontes/pipes";
import { gestoesDoCron } from "@/lib/fontes/registry";
import { nomeDaFonte } from "./coletar";

function getSupabase() {
	return createClient(
		process.env.SUPABASE_URL!,
		process.env.SUPABASE_SERVICE_ROLE_KEY!,
	);
}

/**
 * A partir de quantas horas sem carga a fonte é considerada velha.
 *
 * Folga generosa sobre o intervalo esperado: o Pipefy roda a cada 30 min e só
 * vira alerta depois de 3 horas; as planilhas rodam uma vez por dia e só depois
 * de 30 horas. Um atraso isolado é normal e alarmar por ele ensinaria a ignorar
 * o alarme — o que importa é o agendador ter PARADO, não ter tropeçado.
 */
export const LIMITE_FRESCOR_HORAS = { pipefy: 3, planilha: 30 } as const;

export interface FrescorDaFonte {
	fonteRef: string;
	tipo: "pipefy" | "planilha";
	/** Nome legível, para a tela poder DIZER qual fonte está atrasada. */
	nome: string;
	/** Última carga BEM-SUCEDIDA. `null` = nunca houve. */
	ultimaCarga: string | null;
	horasDesdeAUltima: number | null;
	/**
	 * Idade dividida pelo limite da PRÓPRIA fonte. > 1 = atrasada.
	 *
	 * É o que torna fontes de cadência diferente comparáveis. A planilha
	 * sincroniza uma vez por dia e vai estar sempre com horas de idade; o Pipefy,
	 * a cada 30 minutos. Comparar as duas em horas absolutas faz a planilha
	 * saudável parecer sempre a mais atrasada — e esconder o Pipefy, que é quem
	 * de fato parou.
	 */
	atraso: number;
}

export interface Frescor {
	fontes: FrescorDaFonte[];
	/**
	 * A fonte mais próxima de estourar o próprio limite — a que a tela mostra.
	 *
	 * Não é a mais antiga em horas: ver `atraso`. Quando nada está atrasado, esta
	 * ainda é a resposta certa para "quão atual é o que estou vendo", porque é o
	 * ponto mais fraco do conjunto.
	 */
	maisAtrasada: FrescorDaFonte | null;
	algumaVelha: boolean;
}

/**
 * Idade do dado, por fonte ativa.
 *
 * Só as fontes que o cron mantém: o pipe encerrado e as planilhas de gestões
 * passadas não recebem carga nova por definição, e cobrá-las produziria um
 * alerta permanente que nunca tem conserto.
 */
export async function medirFrescor(agora: Date = new Date()): Promise<Frescor> {
	const supabase = getSupabase();

	const ativas: { ref: string; tipo: "pipefy" | "planilha" }[] = [
		...pipesDoCron().map((p) => ({ ref: p.pipeId, tipo: "pipefy" as const })),
		...gestoesDoCron().map((g) => ({
			ref: g.contratos.spreadsheetId,
			tipo: "planilha" as const,
		})),
	];

	const { data, error } = await supabase
		.from("ingestao_execucao")
		.select("fonte_ref, terminado_em")
		.eq("status", "ok")
		.order("id_execucao", { ascending: false })
		.limit(500);

	if (error) {
		console.warn(`[Frescor] Não foi possível medir: ${error.message}`);
		return { fontes: [], maisAtrasada: null, algumaVelha: false };
	}

	const ultimaPorFonte = new Map<string, string>();
	for (const e of data ?? []) {
		if (!e.terminado_em) continue;
		if (!ultimaPorFonte.has(e.fonte_ref)) {
			ultimaPorFonte.set(e.fonte_ref, e.terminado_em);
		}
	}

	const fontes: FrescorDaFonte[] = ativas.map(({ ref, tipo }) => {
		const ultima = ultimaPorFonte.get(ref) ?? null;
		const horas = ultima
			? (agora.getTime() - new Date(ultima).getTime()) / 3_600_000
			: null;
		return {
			fonteRef: ref,
			tipo,
			nome: nomeDaFonte(ref),
			ultimaCarga: ultima,
			horasDesdeAUltima: horas,
			// Fonte que nunca carregou é o caso mais GRAVE, não o mais leve: atraso
			// infinito, para nunca ficar atrás de uma que só está atrasadinha.
			atraso:
				horas === null
					? Number.POSITIVE_INFINITY
					: horas / LIMITE_FRESCOR_HORAS[tipo],
		};
	});

	const maisAtrasada =
		fontes.length > 0
			? fontes.reduce((a, b) => (b.atraso > a.atraso ? b : a))
			: null;

	return {
		fontes,
		maisAtrasada,
		algumaVelha: fontes.some((f) => f.atraso > 1),
	};
}

// ─── O agendador principal ────────────────────────────────────────

/**
 * Há quantas horas o pg_cron não dispara.
 *
 * Só o `pg_net` grava em `disparo_recente` — chamada do GitHub Actions vai
 * direto ao endpoint e não passa por lá. É essa separação que impede a rede de
 * segurança de mascarar a queda do agendador principal: sem ela, uma rodada do
 * Actions a cada 6h manteria o dado "fresco o bastante" e ninguém descobriria
 * que o pg_cron parou.
 *
 * `null` = a view não existe (migration 0008 não aplicada) ou nunca houve
 * disparo. Não é o mesmo que "está tudo bem", e quem chama precisa distinguir.
 */
export async function horasDesdeOAgendador(): Promise<number | null> {
	const { data, error } = await getSupabase()
		.from("disparo_recente")
		.select("created")
		.order("created", { ascending: false })
		.limit(1);

	if (error || !data || data.length === 0) return null;
	return (Date.now() - new Date(data[0].created).getTime()) / 3_600_000;
}

/** Limite para o agendador principal: dispara a cada 30 min, com folga larga. */
export const LIMITE_AGENDADOR_HORAS = 3;
