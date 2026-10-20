// src/lib/fontes/tabela.ts
//
// Leitor de abas tabulares (estratégia "tabela"): resolve cada coluna pelo NOME
// do cabeçalho, nunca pela posição — salvo exceção declarada com motivo.
//
// Por que isso importa: os parsers antigos (src/lib/sheets.ts) liam `row[13]`.
// Inserir uma coluna na planilha deslocava todos os campos seguintes em silêncio,
// e o dashboard continuava mostrando números — errados. Aqui, uma coluna que
// some vira erro com o nome dela.

import { normalizarCabecalho, letraColuna } from "./normalizar";
import type {
	CampoContrato,
	FonteTabela,
	IdGestao,
	LinhaDescartada,
	LinhaTabela,
	TabelaLida,
} from "./tipos";

export class ErroLeituraPlanilha extends Error {
	constructor(
		message: string,
		readonly contexto: { spreadsheetId: string; aba: string },
	) {
		super(message);
		this.name = "ErroLeituraPlanilha";
	}
}

/**
 * Mapeia cabeçalho normalizado → índice da coluna.
 *
 * Cabeçalho repetido é registrado como ambíguo: casar por nome deixa de ser
 * possível e qualquer campo que dependa dele falha. (A aba
 * "Metas por coordenação" tem oito cabeçalhos repetidos — é um caso real.)
 */
function indexarCabecalhos(linha: string[]): {
	indice: Map<string, number>;
	ambiguos: Set<string>;
} {
	const indice = new Map<string, number>();
	const ambiguos = new Set<string>();

	linha.forEach((celula, i) => {
		const chave = normalizarCabecalho(celula ?? "");
		if (!chave) return;
		if (indice.has(chave)) {
			ambiguos.add(chave);
			return;
		}
		indice.set(chave, i);
	});

	return { indice, ambiguos };
}

/**
 * Resolve os localizadores de coluna contra o cabeçalho real da aba.
 * Lança se um campo obrigatório não for encontrado, nomeando a coluna.
 */
export function resolverColunas(
	fonte: FonteTabela,
	cabecalhos: string[],
): Partial<Record<CampoContrato, number>> {
	const { indice, ambiguos } = indexarCabecalhos(cabecalhos);
	const resolucao: Partial<Record<CampoContrato, number>> = {};
	const faltando: string[] = [];

	for (const [campo, loc] of Object.entries(fonte.colunas) as [
		CampoContrato,
		FonteTabela["colunas"][CampoContrato],
	][]) {
		if (!loc) continue;

		if (loc.tipo === "posicao") {
			if (loc.indice >= cabecalhos.length) {
				faltando.push(
					`${campo}: posição ${letraColuna(loc.indice)} não existe na aba`,
				);
				continue;
			}
			resolucao[campo] = loc.indice;
			continue;
		}

		const chave = normalizarCabecalho(loc.nome);

		if (ambiguos.has(chave)) {
			faltando.push(
				`${campo}: o cabeçalho "${loc.nome}" aparece mais de uma vez — impossível casar por nome`,
			);
			continue;
		}

		const i = indice.get(chave);
		if (i === undefined) {
			faltando.push(`${campo}: cabeçalho "${loc.nome}" não encontrado`);
			continue;
		}

		resolucao[campo] = i;
	}

	const obrigatoriosAusentes = fonte.obrigatorios.filter(
		(c) => resolucao[c] === undefined,
	);

	if (obrigatoriosAusentes.length > 0) {
		const detalhe = faltando.length > 0 ? `\n  - ${faltando.join("\n  - ")}` : "";
		throw new ErroLeituraPlanilha(
			`Aba "${fonte.aba}": campo(s) obrigatório(s) não resolvido(s): ` +
				`${obrigatoriosAusentes.join(", ")}.${detalhe}\n` +
				`  Cabeçalhos encontrados: ${cabecalhos
					.map((c, i) => `${letraColuna(i)}="${c}"`)
					.filter((_, i) => (cabecalhos[i] ?? "").trim() !== "")
					.join(", ")}`,
			{ spreadsheetId: fonte.spreadsheetId, aba: fonte.aba },
		);
	}

	return resolucao;
}

function temValor(valores: Partial<Record<CampoContrato, string>>, campo: CampoContrato) {
	return (valores[campo] ?? "").trim() !== "";
}

/**
 * A linha é uma tentativa de registro, ou é ruído estrutural da planilha?
 *
 * Critério: tem conteúdo em pelo menos UM campo obrigatório. Como os
 * obrigatórios são justamente os que descrevem o contrato (mês, projeto,
 * coordenação), uma linha sem nenhum deles não descreve nada — não há o que
 * rejeitar nem o que corrigir.
 *
 * Calibrado no dado real. A aba de 23/24 tem 343 linhas com "R$ 0,00" em
 * `Valor Vendido real` E em `Preço por Semana`, resultado de fórmula arrastada
 * por centenas de linhas vazias: nenhum campo obrigatório preenchido → ruído.
 * Já a linha 33, com 13 células e valor preenchido faltando só o nome do projeto,
 * tem mês e coordenação → é rejeição, e precisa aparecer como tal.
 *
 * (Contar células preenchidas seria mais simples e estaria errado: as linhas de
 * fórmula têm duas.)
 */
function temSubstancia(
	valores: Partial<Record<CampoContrato, string>>,
	obrigatorios: CampoContrato[],
): boolean {
	return obrigatorios.some((c) => temValor(valores, c));
}

/**
 * Interpreta a grade já lida de uma aba tabular.
 *
 * Recebe a grade em vez de buscá-la para manter a função pura e testável — quem
 * fala com a API do Sheets é `sheets-fonte.ts`.
 */
export function lerTabela(
	gestao: IdGestao,
	fonte: FonteTabela,
	grade: string[][],
): TabelaLida {
	if (grade.length < fonte.linhaCabecalho) {
		throw new ErroLeituraPlanilha(
			`Aba "${fonte.aba}": esperava cabeçalho na linha ${fonte.linhaCabecalho}, ` +
				`mas a aba tem só ${grade.length} linha(s).`,
			{ spreadsheetId: fonte.spreadsheetId, aba: fonte.aba },
		);
	}

	const cabecalhos = grade[fonte.linhaCabecalho - 1] ?? [];
	const resolucao = resolverColunas(fonte, cabecalhos);

	const linhas: LinhaTabela[] = [];
	const descartadas: LinhaDescartada[] = [];
	let ignoradas = 0;

	for (let i = fonte.linhaCabecalho; i < grade.length; i++) {
		const bruta = grade[i] ?? [];

		const valores: Partial<Record<CampoContrato, string>> = {};
		for (const [campo, idx] of Object.entries(resolucao) as [
			CampoContrato,
			number,
		][]) {
			// O Sheets corta células vazias no fim da linha, então índices altos
			// podem simplesmente não existir — vira string vazia, não undefined.
			valores[campo] = (bruta[idx] ?? "").trim();
		}

		const linhaPlanilha = i + 1;
		const origemRef = `${fonte.spreadsheetId}#${fonte.aba}#L${linhaPlanilha}`;

		// Ruído estrutural (fórmula arrastada, linha de formatação) não é nem
		// tentativa de registro: só conta, não vira rejeição.
		if (!temSubstancia(valores, fonte.obrigatorios)) {
			ignoradas++;
			continue;
		}

		const camposFaltando = fonte.obrigatorios.filter((c) => !temValor(valores, c));
		if (camposFaltando.length > 0) {
			descartadas.push({
				linhaPlanilha,
				origemRef,
				motivo: `campo(s) obrigatório(s) sem valor: ${camposFaltando.join(", ")}`,
				camposFaltando,
				valores,
			});
			continue;
		}

		linhas.push({ valores, linhaPlanilha, origemRef });
	}

	return {
		gestao,
		spreadsheetId: fonte.spreadsheetId,
		aba: fonte.aba,
		linhas,
		descartadas,
		ignoradas,
		resolucao,
	};
}
