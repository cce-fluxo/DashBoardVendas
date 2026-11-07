// src/lib/fontes/indicacoes.ts
//
// Lê as respostas do formulário da campanha de indicações. Puro (grade em
// memória): a rede fica em sheets-fonte.ts.
//
// Cabeçalhos casados pelo COMEÇO do texto: são perguntas do Forms ("Seu nome,
// caveira") e qualquer ajuste de redação na pergunta mudaria o cabeçalho
// inteiro. Só três colunas são lidas; os dados do contato indicado ficam na
// planilha (ver 0019).

import { normalizarCabecalho } from "./normalizar";

export interface IndicacaoLida {
	carimbo: string;
	indicador: string;
	coordenacao: string | null;
	origemRef: string;
}

export interface IndicacoesLidas {
	indicacoes: IndicacaoLida[];
	rejeitadas: { origemRef: string; motivo: string; linha: string[] }[];
	/** Linhas totalmente vazias. */
	ignoradas: number;
	/** Cabeçalho reconhecido: sem ele, zero indicações é leitura quebrada, não campanha vazia. */
	cabecalhoOk: boolean;
	avisos: string[];
}

export function lerIndicacoes(spreadsheetId: string, aba: string, grade: string[][]): IndicacoesLidas {
	const r: IndicacoesLidas = { indicacoes: [], rejeitadas: [], ignoradas: 0, cabecalhoOk: false, avisos: [] };
	const cab = (grade[0] ?? []).map((c) => normalizarCabecalho(c ?? ""));
	const col = (inicio: string) => cab.findIndex((c) => c.startsWith(inicio));
	const c = { carimbo: col("carimbo"), nome: col("seu nome"), coordenacao: col("qual a sua coordenacao") };
	if (c.carimbo < 0 || c.nome < 0) {
		r.avisos.push(`aba "${aba}": cabeçalho sem "Carimbo de data/hora" ou "Seu nome"; nada lido.`);
		return r;
	}
	r.cabecalhoOk = true;

	const vistos = new Set<string>();
	grade.slice(1).forEach((linha, i) => {
		const cel = (j: number) => (j < 0 ? "" : (linha[j] ?? "").trim());
		const origemRef = `${spreadsheetId}#${aba}#${i + 2}`;
		if (linha.every((x) => !(x ?? "").trim())) return void r.ignoradas++;

		const carimbo = cel(c.carimbo);
		// Espaço duplo e caixa variam entre respostas da mesma pessoa.
		const indicador = cel(c.nome).replace(/\s+/g, " ");
		if (!carimbo || !indicador) {
			r.rejeitadas.push({ origemRef, motivo: !carimbo ? "sem carimbo de data/hora" : "sem o nome de quem indicou", linha });
			return;
		}
		const chave = `${carimbo}|${indicador}`;
		if (vistos.has(chave)) {
			r.rejeitadas.push({ origemRef, motivo: `resposta repetida (${indicador}, ${carimbo})`, linha });
			return;
		}
		vistos.add(chave);
		r.indicacoes.push({ carimbo, indicador, coordenacao: cel(c.coordenacao) || null, origemRef });
	});
	return r;
}
