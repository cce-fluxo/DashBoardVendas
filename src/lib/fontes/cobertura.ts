// src/lib/fontes/cobertura.ts
//
// O que cada fonte REALMENTE cobre no tempo.
//
// Sem isto, um período sem funil e um período com funil zerado são o mesmo
// número na tela: 0. O primeiro quer dizer "ninguém mediu"; o segundo, "mediram
// e não houve". Apresentar os dois como iguais é o erro mais caro que um dash de
// fonte da verdade pode cometer, porque ele é invisível — o gráfico fica bonito.
//
// É o mesmo princípio de `etapasNaoInstrumentadas` em pipes.ts, um nível acima:
// lá é a etapa que não existia, aqui é o período inteiro.
//
// COBERTURA ≠ EXISTÊNCIA DE REGISTROS. Um mês sem nenhum card, mas com o CRM em
// uso, ESTÁ coberto — a medição aconteceu e deu zero. O que a cobertura declara
// é a janela em que a fonte era o sistema de registro.

import { PIPES } from "./pipes";
import { GESTOES } from "./registry";

export interface Cobertura {
	fonteTipo: "pipefy" | "planilha";
	fonteRef: string;
	/** null = vale para qualquer gestão. */
	gestao: string | null;
	inicioISO: string;
	/** null = ainda em uso, sem fim conhecido. */
	fimISO: string | null;
	observacao: string;
}

// Fuso do dado: tudo no projeto é ancorado em Brasília.
const OFFSET_BRASIL = "-03:00";

/**
 * Primeiro card do pipe novo: 30/06/2025. O último do pipe antigo é 27/06/2025.
 *
 * A cobertura do antigo vai até 29/06 e não até 27/06 de propósito: 28 e 29/06
 * não são buraco de medição, são dois dias sem venda com o CRM antigo no ar.
 * O `observacao` guarda a data do último card para quem for conferir.
 */
const FIM_PIPE_ANTIGO = `2025-06-29T23:59:59.999${OFFSET_BRASIL}`;

export const COBERTURAS: Cobertura[] = [
	{
		fonteTipo: "pipefy",
		fonteRef: "303819426",
		gestao: null,
		inicioISO: `2023-12-18T00:00:00.000${OFFSET_BRASIL}`,
		fimISO: FIM_PIPE_ANTIGO,
		observacao:
			'Pipe "CRM Fluxo", encerrado. 1608 cards, primeiro em 18/12/2023 e ' +
			"último em 27/06/2025. Não instrumenta 'Contato aberto' nem " +
			"'Precificação/Aprovação em andamento'.",
	},
	{
		fonteTipo: "pipefy",
		fonteRef: "306460930",
		gestao: null,
		inicioISO: `2025-06-30T00:00:00.000${OFFSET_BRASIL}`,
		fimISO: null,
		observacao: 'Pipe "CRM COM", em uso. Instrumenta as 8 etapas canônicas.',
	},
	// As planilhas cobrem a gestão inteira: cada gestão tem a sua, oficial, e a
	// aba "Contratos" começa em outubro. Declarado explicitamente para que a
	// ausência de funil em 23/24 não seja lida como ausência de vendas.
	...GESTOES.map(
		(g): Cobertura => ({
			fonteTipo: "planilha",
			fonteRef: g.contratos.spreadsheetId,
			gestao: g.id,
			inicioISO: `${g.anoInicio}-10-01T00:00:00.000${OFFSET_BRASIL}`,
			fimISO: `${g.anoInicio + 1}-09-30T23:59:59.999${OFFSET_BRASIL}`,
			observacao: `Planilha oficial da gestão ${g.id}: abas "Contratos" e "Metas por coordenação".`,
		}),
	),
];

// ─── Lacunas de funil ─────────────────────────────────────────────

export interface Lacuna {
	inicio: Date;
	fim: Date;
	/** Dias inteiros do buraco. */
	dias: number;
}

function coberturasDeFunil(): { inicio: number; fim: number }[] {
	return COBERTURAS.filter(
		(c) => c.fonteTipo === "pipefy" && PIPES.some((p) => p.pipeId === c.fonteRef),
	)
		.map((c) => ({
			inicio: new Date(c.inicioISO).getTime(),
			fim: c.fimISO ? new Date(c.fimISO).getTime() : Number.POSITIVE_INFINITY,
		}))
		.sort((a, b) => a.inicio - b.inicio);
}

/**
 * Trechos de [inicio, fim] em que NENHUM pipe estava no ar.
 *
 * Devolve lista vazia quando o período é totalmente coberto. Buracos de menos de
 * um dia são descartados: são emenda entre pipes, não falta de medição, e um
 * aviso por causa deles seria o tipo de ruído que faz as pessoas pararem de ler
 * os avisos que importam.
 */
export function lacunasDeFunil(inicio: Date, fim: Date): Lacuna[] {
	const janelas = coberturasDeFunil();
	const lacunas: { de: number; ate: number }[] = [];

	let cursor = inicio.getTime();
	for (const j of janelas) {
		if (j.fim < cursor) continue;
		if (j.inicio > cursor) {
			lacunas.push({ de: cursor, ate: Math.min(j.inicio, fim.getTime()) });
		}
		cursor = Math.max(cursor, j.fim);
		if (cursor >= fim.getTime()) break;
	}
	if (cursor < fim.getTime()) lacunas.push({ de: cursor, ate: fim.getTime() });

	const UM_DIA = 24 * 60 * 60 * 1000;
	return lacunas
		.filter((l) => l.ate - l.de >= UM_DIA)
		.map((l) => ({
			inicio: new Date(l.de),
			fim: new Date(l.ate),
			dias: Math.round((l.ate - l.de) / UM_DIA),
		}));
}

const fmt = new Intl.DateTimeFormat("pt-BR", {
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	timeZone: "America/Sao_Paulo",
});

/**
 * Frase pronta sobre a falta de funil no período, ou `null` se está tudo coberto.
 *
 * Devolve texto e não um booleano porque "tem lacuna" não ajuda ninguém a
 * decidir nada: o que muda a leitura do gráfico é QUANTO do período ficou de
 * fora e QUANDO.
 */
export function avisoDeLacunaFunil(
	inicio: Date,
	fim: Date,
): { texto: string; diasSemFunil: number; diasDoPeriodo: number } | null {
	const lacunas = lacunasDeFunil(inicio, fim);
	if (lacunas.length === 0) return null;

	const UM_DIA = 24 * 60 * 60 * 1000;
	const diasDoPeriodo = Math.max(
		1,
		Math.round((fim.getTime() - inicio.getTime()) / UM_DIA),
	);
	const diasSemFunil = lacunas.reduce((s, l) => s + l.dias, 0);
	const trechos = lacunas
		.map((l) => `${fmt.format(l.inicio)} a ${fmt.format(l.fim)}`)
		.join(" e ");

	const pct = Math.round((diasSemFunil / diasDoPeriodo) * 100);

	return {
		diasSemFunil,
		diasDoPeriodo,
		texto:
			`Sem funil em ${trechos} (${diasSemFunil} de ${diasDoPeriodo} dias, ${pct}% do período). ` +
			`Não havia CRM no ar nesse trecho — as vendas dele estão nas planilhas, ` +
			`mas o caminho até a venda não foi registrado. As conversões abaixo valem ` +
			`só para o restante do período.`,
	};
}
