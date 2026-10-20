// src/lib/fontes/pipes.ts
//
// Registry dos pipes do Pipefy: como cada um nomeia as fases e os campos.
//
// DEFINIÇÃO ÚNICA. Antes existiam duas cópias das constantes de fase — uma em
// sync-pipefy.ts e outra em backfill-pipefy.ts, mantidas em sincronia à mão.
// Com um pipe já era risco; com dois seria garantia de divergência.
//
// TUDO AQUI FOI VERIFICADO nos dois pipes em 01/08/2026 com
// `npx tsx scripts/inspecionar-pipe.ts 303819426 306460930`.

import { normalizarCabecalho } from "./normalizar";

/** As 8 etapas comerciais canônicas, na ordem do funil. */
export const ETAPAS_CANONICAS = [
	"Oportunidade",
	"Contato aberto",
	"Pré-diagnóstico feito",
	"Diagnóstico feito",
	"Precificação/Aprovação em andamento",
	"Proposta comercial feita",
	"Follow-up",
	"Venda",
] as const;

export type EtapaCanonica = (typeof ETAPAS_CANONICAS)[number];
export type EtapaTerminal = "Perdido" | "Pausado";

/** Campos que a ingestão precisa extrair de um card. */
export type CampoCard =
	| "coordenacao"
	| "responsavel"
	| "valorProposta"
	| "canalAquisicao";

export interface MapaPipe {
	pipeId: string;
	nome: string;
	/** Nome da fase no Pipefy → etapa canônica. */
	fasesComerciais: Record<string, EtapaCanonica>;
	fasesTerminais: Record<string, EtapaTerminal>;
	/** Fases que não são do funil (formulário de entrada, etc.). */
	fasesIgnoradas: string[];
	/** Campo canônico → label do campo NESTE pipe. */
	campos: Partial<Record<CampoCard, string>>;
	/**
	 * Etapas canônicas que este pipe NÃO instrumenta.
	 *
	 * Não é o mesmo que "conversão zero". A etapa não existia — ninguém passou
	 * por ela porque ela não estava lá. Tratar as duas coisas igual produz um
	 * número plausível e falso, e é por isso que a camada de cálculo precisa
	 * saber disso (não só a UI).
	 */
	etapasNaoInstrumentadas: EtapaCanonica[];
	/** Só o backfill lê pipes encerrados; o cron ignora. */
	encerrado: boolean;
}

// ─── Pipe antigo: "CRM Fluxo" ─────────────────────────────────────
//
// 1608 cards, de 18/12/2023 a 27/06/2025. Encerrado: 1606 dos 1608 estão em
// estado terminal e nenhum card novo entra desde o corte.
//
// Fases sem numeração, capitalização própria, "Pausados" no plural. E duas
// etapas canônicas simplesmente não existem aqui.

const PIPE_ANTIGO: MapaPipe = {
	pipeId: "303819426",
	nome: "CRM Fluxo",
	fasesComerciais: {
		Oportunidade: "Oportunidade",
		"Pré Diagnóstico Feito": "Pré-diagnóstico feito",
		"Diagnóstico Feito": "Diagnóstico feito",
		"Proposta Comercial Feita": "Proposta comercial feita",
		"Follow Up": "Follow-up",
		Venda: "Venda",
	},
	fasesTerminais: {
		Perdido: "Perdido",
		Pausados: "Pausado", // plural — no pipe novo é "Pausado"
	},
	campos: {
		coordenacao: "Coordenação",
		// O pipe novo chama de "Responsável".
		responsavel: "Vendedor Responsável",
		valorProposta: "Valor da proposta",
		// COM EMOJI. `extrairCampo` casava só com toLowerCase().trim(), então
		// "🗣️ canal de aquisição" nunca bateria com "canal de aquisição" — o campo
		// sumiria em silêncio. Ver `normalizarLabel` abaixo.
		canalAquisicao: "🗣️ Canal de aquisição",
	},
	// "Start form" NÃO aparece em `pipe { phases }`, mas está no
	// `phases_history` de TODOS os 1608 cards — a lista de fases do pipe e o
	// vocabulário do histórico são conjuntos diferentes, e a inspeção original
	// olhou só o primeiro. Sem esta entrada, a ingestão rejeita todos os cards.
	fasesIgnoradas: ["Start form"],
	etapasNaoInstrumentadas: [
		// A ausência séria. "Contato aberto" é a base 100% da conversão no pipe
		// novo; aqui a fase não existe. Por isso a base do funil passou a ser
		// Oportunidade, que existe nos dois.
		"Contato aberto",
		"Precificação/Aprovação em andamento",
	],
	encerrado: true,
};

// ─── Pipe atual: "CRM COM" ────────────────────────────────────────
//
// Desde 30/06/2025. Fases numeradas. O typo histórico "4. Dignóstico feito" já
// foi corrigido no Pipefy e o mapeamento dele saiu na F0.

const PIPE_ATUAL: MapaPipe = {
	pipeId: "306460930",
	nome: "CRM COM",
	fasesComerciais: {
		"1. Oportunidade": "Oportunidade",
		"2. Contato aberto": "Contato aberto",
		"3. Pré-diagnóstico feito": "Pré-diagnóstico feito",
		"4. Diagnóstico feito": "Diagnóstico feito",
		"5. Precificação/Aprovação em andamento":
			"Precificação/Aprovação em andamento",
		"6. Proposta comercial feita": "Proposta comercial feita",
		"7. Follow-up": "Follow-up",
		Venda: "Venda",
	},
	fasesTerminais: {
		Perdido: "Perdido",
		Pausado: "Pausado",
	},
	// "Start form" não aparece como fase na API deste pipe (verificado), mas a
	// lista continua existindo porque um pipe futuro pode ter.
	fasesIgnoradas: ["Start form"],
	campos: {
		coordenacao: "Coordenação",
		responsavel: "Responsável",
		valorProposta: "Valor da proposta",
		canalAquisicao: "Canal de aquisição",
	},
	etapasNaoInstrumentadas: [],
	encerrado: false,
};

export const PIPES: MapaPipe[] = [PIPE_ANTIGO, PIPE_ATUAL];

// ─── Acesso ───────────────────────────────────────────────────────

export function buscarPipe(pipeId: string): MapaPipe {
	const p = PIPES.find((x) => x.pipeId === pipeId);
	if (!p) {
		throw new Error(
			`Pipe "${pipeId}" não está no registry. Conhecidos: ${PIPES.map((x) => `${x.pipeId} (${x.nome})`).join(", ")}.`,
		);
	}
	return p;
}

/**
 * Pipes que o cron precisa varrer.
 *
 * O pipe antigo está encerrado — varrê-lo a cada 30 minutos custaria centenas de
 * requisições para reler dado que não muda, e foi o volume de terminais que
 * motivou o `incluirTerminais: false` original.
 */
export function pipesDoCron(): MapaPipe[] {
	return PIPES.filter((p) => !p.encerrado);
}

/** Todos os pipes — usado pelo backfill. */
export function todosOsPipes(): MapaPipe[] {
	return PIPES;
}

// ─── Resolução de fase e campo ────────────────────────────────────

export interface FaseResolvida {
	canonica: EtapaCanonica | EtapaTerminal;
	terminal: boolean;
}

/**
 * Traduz o nome de fase do Pipefy para a etapa canônica.
 * `null` = fase desconhecida, que deve virar REJEIÇÃO, não descarte calado.
 */
export function resolverFase(
	pipe: MapaPipe,
	nomeNoPipefy: string,
): FaseResolvida | null {
	const comercial = pipe.fasesComerciais[nomeNoPipefy];
	if (comercial) return { canonica: comercial, terminal: false };

	const terminal = pipe.fasesTerminais[nomeNoPipefy];
	if (terminal) return { canonica: terminal, terminal: true };

	return null;
}

export function faseIgnorada(pipe: MapaPipe, nomeNoPipefy: string): boolean {
	return pipe.fasesIgnoradas.includes(nomeNoPipefy);
}

/**
 * Forma canônica de um label de campo, para comparação.
 *
 * Além do que `normalizarCabecalho` já faz (acento, caixa, espaço), remove
 * EMOJI e a pontuação decorativa em volta. O pipe antigo chama o campo de
 * "🗣️ Canal de aquisição" — sem isto ele nunca casaria com "Canal de aquisição"
 * e o canal de aquisição de 1608 cards sumiria sem erro nenhum.
 */
export function normalizarLabel(label: string): string {
	return normalizarCabecalho(
		(label ?? "")
			// Símbolos e pictogramas, seletores de variação e ZWJ.
			.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, " "),
	).trim();
}

/** O label deste campo neste pipe casa com o texto dado? */
export function campoCasa(
	pipe: MapaPipe,
	campo: CampoCard,
	labelDoCard: string,
): boolean {
	const esperado = pipe.campos[campo];
	if (!esperado) return false;
	return normalizarLabel(esperado) === normalizarLabel(labelDoCard);
}
