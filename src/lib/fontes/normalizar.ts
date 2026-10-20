// src/lib/fontes/normalizar.ts
//
// Normalização de texto para casar cabeçalhos de planilha por NOME.
//
// Planilha preenchida por gente tem espaço extra, capitalização inconsistente,
// quebra de linha dentro da célula e caracteres visualmente idênticos que são
// pontos de código diferentes. Todas essas variações foram observadas nas três
// planilhas oficiais — ver PLANO-FONTE-DA-VERDADE.md, plano histórico, no repositório privado de arquivo, seção "Diferenças entre as
// planilhas".

/** `º` (indicador ordinal) e `°` (grau) são caracteres distintos que as
 *  planilhas usam de forma intercambiável: "Nº Parcelas" em 23/24 contra
 *  "N° Parcelas" em 24/25 e 25/26. */
const EQUIVALENTES: Record<string, string> = {
	"º": "o", // º ordinal masculino
	"°": "o", // ° grau
	"ª": "a", // ª ordinal feminino
};

/**
 * Forma canônica de um cabeçalho, para comparação.
 *
 * Aplica, nesta ordem: equivalências de caractere, decomposição Unicode e
 * remoção de diacríticos, minúsculas, colapso de qualquer espaço em branco
 * (inclusive quebras de linha) para um espaço só, e trim.
 *
 * "Data de Finalização\n(Estimativa)"  →  "data de finalizacao (estimativa)"
 * "Nº Parcelas"                        →  "no parcelas"
 * "N° Parcelas"                        →  "no parcelas"
 */
export function normalizarCabecalho(texto: string): string {
	let s = texto ?? "";

	for (const [de, para] of Object.entries(EQUIVALENTES)) {
		s = s.split(de).join(para);
	}

	return s
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/** Letra da coluna a partir do índice 0-based: 0 → "A", 26 → "AA". */
export function letraColuna(indice: number): string {
	let n = indice;
	let s = "";
	do {
		s = String.fromCharCode(65 + (n % 26)) + s;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return s;
}
