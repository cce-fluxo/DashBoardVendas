// src/lib/coordenacoes.ts
//
// Quais são as coordenações, e como reconhecer uma.
//
// A lista estava escrita à mão em cinco arquivos (calculations, calculations-
// funil, metas-periodo, fontes/blocos, useDashboardData). Enquanto ninguém
// mexia, as cinco cópias concordavam — é sempre assim que começa. Foi o mesmo
// caminho das sete cópias do calendário.
//
// O que faltava não era só a lista: era a PERGUNTA. Ninguém tinha onde
// perguntar "isto é uma coordenação?", então o código respondia por acidente —
// `coordenacoes[0]`, `coordenacoes.length > 1` — e a resposta dependia de o
// array estar limpo. Não estava: a ingestão gravava IDs internos do Pipefy
// junto dos rótulos (ver `extrairValores` em sync-pipefy.ts).
//
// O campo "Coordenação" do Pipefy é texto livre para quem preenche: além das
// cinco, o board tem "NP", "AN", "N2", "CONTRATO" e "PAUSADO". Não filtramos na
// ingestão — o banco guarda o que a fonte disse. É aqui, na leitura, que se
// decide o que conta.

import { Coordenacao } from "@/types";

export const COORDENACOES: Coordenacao[] = ["CCE", "ACE", "MNP", "QAB", "PRO"];

const CONHECIDAS = new Set<string>(COORDENACOES);

export function ehCoordenacao(valor: string): valor is Coordenacao {
	return CONHECIDAS.has(valor);
}

/**
 * Só as coordenações reconhecidas, na ordem canônica e sem repetição.
 *
 * A ordem é fixa de propósito: dois cards com o mesmo par de coordenações
 * precisam produzir o mesmo rótulo, independentemente da ordem em que alguém
 * marcou as caixas no Pipefy.
 */
export function apenasCoordenacoes(valores: readonly string[]): Coordenacao[] {
	const presentes = new Set(valores);
	return COORDENACOES.filter((c) => presentes.has(c));
}

/** Cross-sell é ter DUAS coordenações reconhecidas — não ter dois valores. */
export function ehCrossSell(valores: readonly string[]): boolean {
	return apenasCoordenacoes(valores).length > 1;
}

/**
 * Rótulos que a fonte trouxe e que não são coordenação nenhuma.
 *
 * Serve para mostrar o que ficou de fora. Um card com "NP" no campo não aparece
 * em linha alguma da tabela por coordenação, e sem isto o desaparecimento é
 * indistinguível de o card não existir.
 */
export function rotulosDesconhecidos(valores: readonly string[]): string[] {
	return [...new Set(valores)].filter((v) => !CONHECIDAS.has(v));
}
