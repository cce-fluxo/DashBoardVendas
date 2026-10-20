// src/lib/periodos-disponiveis.ts
//
// Quais períodos a tela pode oferecer, e em que estado.
//
// Princípio: A TELA NUNCA OFERECE UMA ESCOLHA QUE NÃO EXISTE. As listas fixas
// que havia no seletor (`Q1..Q4`, doze meses, duas gestões) ofereciam o 4º ciclo
// numa gestão que tinha três, e meses que ainda não aconteceram — clicar levava
// a uma tela vazia sem explicação.
//
// Aqui não existe estado "inexistente": o que não existe simplesmente não entra
// na lista. Só aparece o que é escolhível ou o que merece explicação.
//
// Puro e sem rede: roda igual no servidor e no cliente, e é testável sem mock.

import type { PeriodoCiclo, PeriodoGestao } from "@/types";
import { GESTOES, buscarGestao, idsDeGestao } from "@/lib/fontes/registry";
import { MESES_DA_GESTAO, mesesDoCiclo } from "@/lib/fontes/calendario";
import {
	anoInicioGestao,
	gestaoAtual,
	janelaCiclo,
	janelaMes,
	rotuloCiclo,
} from "@/lib/periodo-gestao";

export type EstadoPeriodo =
	/** Já começou e pode ser escolhido. */
	| "disponivel"
	/** Existe no calendário mas ainda não começou. Aparece desabilitado. */
	| "futuro";

export interface OpcaoPeriodo {
	/** Valor enviado à API: id do ciclo ou "01".."12". */
	valor: string;
	/** O que a pessoa lê. Carrega nome E intervalo de datas. */
	rotulo: string;
	/** Versão curta, para telas estreitas. */
	rotuloCurto: string;
	estado: EstadoPeriodo;
	/** Por que está desabilitado. Ausência precisa ser explicada, não só bloqueada. */
	motivo?: string;
}

const NOMES_CURTOS: Record<string, string> = {
	"01": "Jan", "02": "Fev", "03": "Mar", "04": "Abr",
	"05": "Mai", "06": "Jun", "07": "Jul", "08": "Ago",
	"09": "Set", "10": "Out", "11": "Nov", "12": "Dez",
};

const NOMES_LONGOS: Record<string, string> = {
	"01": "Janeiro", "02": "Fevereiro", "03": "Março", "04": "Abril",
	"05": "Maio", "06": "Junho", "07": "Julho", "08": "Agosto",
	"09": "Setembro", "10": "Outubro", "11": "Novembro", "12": "Dezembro",
};

/** Gestões cadastradas, da mais recente para a mais antiga. */
export function gestoesDisponiveis(): OpcaoPeriodo[] {
	return [...GESTOES]
		.sort((a, b) => b.anoInicio - a.anoInicio)
		.map((g) => ({
			valor: g.id,
			rotulo: rotuloGestao(g.id),
			rotuloCurto: g.id,
			estado: "disponivel" as const,
		}));
}

/** "Gestão 24/25 · Out/2024–Set/2025" */
export function rotuloGestao(gestao: PeriodoGestao): string {
	const ano = anoInicioGestao(gestao);
	return `Gestão ${gestao} · Out/${ano}–Set/${ano + 1}`;
}

/**
 * Ciclos de uma gestão, com estado.
 *
 * A lista tem 3 itens em 23/24 e 24/25, e 4 em 25/26 — porque é isso que essas
 * gestões têm. O seletor antigo mostrava 4 sempre.
 */
export function ciclosDisponiveis(
	gestao: PeriodoGestao,
	hoje: Date = new Date(),
): OpcaoPeriodo[] {
	return buscarGestao(gestao).ciclos.map((c) => {
		const { inicio } = janelaCiclo(c.id, gestao);
		const futuro = inicio > hoje;
		const meses = mesesDoCiclo(c);

		return {
			valor: c.id,
			rotulo: rotuloCiclo(c.id, gestao),
			rotuloCurto: `${c.rotulo} · ${NOMES_CURTOS[meses[0]]}–${NOMES_CURTOS[meses[meses.length - 1]]}`,
			estado: futuro ? "futuro" : "disponivel",
			motivo: futuro ? "ainda não iniciado" : undefined,
		};
	});
}

/**
 * Meses de uma gestão, na ordem Out→Set, com estado.
 *
 * Mês que ainda não começou fica desabilitado: antes ele era selecionável e
 * levava a um dashboard zerado, indistinguível de "não vendemos nada".
 */
export function mesesDisponiveis(
	gestao: PeriodoGestao,
	hoje: Date = new Date(),
): OpcaoPeriodo[] {
	const ano = anoInicioGestao(gestao);

	return MESES_DA_GESTAO.map((mes) => {
		const { inicio } = janelaMes(mes, gestao);
		const futuro = inicio > hoje;
		const anoDoMes = parseInt(mes, 10) >= 10 ? ano : ano + 1;

		return {
			valor: mes,
			rotulo: `${NOMES_LONGOS[mes]}/${anoDoMes}`,
			rotuloCurto: `${NOMES_CURTOS[mes]}/${String(anoDoMes).slice(2)}`,
			estado: futuro ? ("futuro" as const) : ("disponivel" as const),
			motivo: futuro ? "ainda não iniciado" : undefined,
		};
	});
}

// ─── Reconciliação ao trocar de gestão ────────────────────────────

export interface SelecaoPeriodo {
	tipo: "gestao" | "ciclo" | "mes";
	gestao: PeriodoGestao;
	ciclo?: PeriodoCiclo;
	mes?: string;
}

export interface Reconciliacao {
	selecao: SelecaoPeriodo;
	/** Preenchido quando a seleção precisou mudar. A troca nunca é silenciosa. */
	aviso?: string;
}

/**
 * Ajusta a seleção ao trocar de gestão.
 *
 * O problema real: os ciclos têm ids próprios por gestão. Estando em
 * "Ciclo Apollo" (25/26) e trocando para 24/25, o id não existe lá — antes isso
 * deixava o seletor num período inválido, e agora o motor lançaria erro.
 *
 * Regra: mantém o ciclo se ele existir; senão escolhe o ciclo da nova gestão que
 * cobre o MESMO MÊS INICIAL, que preserva "onde no ano eu estava olhando"; se
 * nem isso der, cai para a gestão inteira. Em qualquer troca, avisa.
 */
export function reconciliarSelecao(
	atual: SelecaoPeriodo,
	novaGestao: PeriodoGestao,
	hoje: Date = new Date(),
): Reconciliacao {
	if (!idsDeGestao().includes(novaGestao)) {
		return {
			selecao: { tipo: "gestao", gestao: novaGestao },
			aviso: `A gestão ${novaGestao} não tem fonte cadastrada.`,
		};
	}

	if (atual.tipo === "gestao") {
		return { selecao: { tipo: "gestao", gestao: novaGestao } };
	}

	if (atual.tipo === "mes" && atual.mes) {
		const opcao = mesesDisponiveis(novaGestao, hoje).find(
			(m) => m.valor === atual.mes,
		);
		if (opcao && opcao.estado === "disponivel") {
			return { selecao: { tipo: "mes", gestao: novaGestao, mes: atual.mes } };
		}
		return {
			selecao: { tipo: "gestao", gestao: novaGestao },
			aviso: `${NOMES_LONGOS[atual.mes] ?? atual.mes} ainda não aconteceu na gestão ${novaGestao}. Mostrando a gestão inteira.`,
		};
	}

	if (atual.tipo === "ciclo" && atual.ciclo) {
		const nova = buscarGestao(novaGestao);

		// 1. Mesmo id existe na gestão nova?
		const mesmo = nova.ciclos.find((c) => c.id === atual.ciclo);
		if (mesmo) {
			return {
				selecao: { tipo: "ciclo", gestao: novaGestao, ciclo: mesmo.id },
			};
		}

		// 2. Ciclo que cobre o mesmo mês inicial — "o mesmo trecho do ano".
		const antiga = buscarGestao(atual.gestao);
		const cicloAntigo = antiga.ciclos.find((c) => c.id === atual.ciclo);
		const mesInicial = cicloAntigo?.mesInicio;

		const equivalente = mesInicial
			? nova.ciclos.find((c) => mesesDoCiclo(c).includes(mesInicial))
			: undefined;

		if (equivalente) {
			const disponivel = ciclosDisponiveis(novaGestao, hoje).find(
				(o) => o.valor === equivalente.id,
			);
			if (disponivel?.estado === "disponivel") {
				return {
					selecao: { tipo: "ciclo", gestao: novaGestao, ciclo: equivalente.id },
					aviso:
						`"${cicloAntigo?.rotulo}" não existe na gestão ${novaGestao}. ` +
						`Mostrando "${equivalente.rotulo}", que cobre o mesmo trecho do ano.`,
				};
			}
		}

		return {
			selecao: { tipo: "gestao", gestao: novaGestao },
			aviso:
				`"${cicloAntigo?.rotulo ?? atual.ciclo}" não existe na gestão ` +
				`${novaGestao}. Mostrando a gestão inteira.`,
		};
	}

	return { selecao: { tipo: "gestao", gestao: novaGestao } };
}

/** Seleção inicial: gestão vigente, período inteiro. Única fonte de default. */
export function selecaoPadrao(hoje: Date = new Date()): SelecaoPeriodo {
	return { tipo: "gestao", gestao: gestaoAtual(hoje) };
}

/**
 * Descrição do período ativo, para o cabeçalho das telas.
 *
 * Existia copiada em três páginas como `formatarPeriodoAtivo`, cada uma com sua
 * própria tabela de ciclos trimestrais e o rótulo de gestão escrito à mão. Eram
 * três das SETE cópias do calendário que este projeto tinha.
 */
export function descricaoPeriodo(
	tipo: string,
	gestao: PeriodoGestao,
	ciclo?: string,
	mes?: string,
): string {
	if (tipo === "mes" && mes) {
		return (
			mesesDisponiveis(gestao).find((m) => m.valor === mes)?.rotulo ?? mes
		);
	}
	if (tipo === "ciclo" && ciclo) {
		return rotuloCiclo(ciclo, gestao);
	}
	const ano = anoInicioGestao(gestao);
	return `Out/${ano} — Set/${ano + 1}`;
}
