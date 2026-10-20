// src/lib/exportar/legenda.ts
//
// O que uma imagem exportada precisa carregar para continuar verdadeira depois
// de sair do dashboard.
//
// UMA IMAGEM É UM NÚMERO SEM RÉGUA
//
// Um print de funil colado num slide perde tudo o que a tela dizia em volta: o
// período, o filtro de coordenação e a data do dado. Meses depois, ninguém
// consegue reconstruir de que recorte ele veio — e o gráfico continua parecendo
// atual. É a mesma falha que IdadeDoDado corrigiu no cabeçalho: o dado não
// mentia, a moldura é que dizia "agora".
//
// A legenda existe para que a imagem responda sozinha "de quando e de quem é
// este número". Ela é curta de propósito: cada fato aparece UMA vez.
//   · o período já está no selo do cabeçalho do card → não se repete aqui;
//   · a coordenação só existe na barra lateral, invisível no recorte → entra;
//   · a idade do dado não está em lugar nenhum do card → entra.
//
// A COORDENAÇÃO VEM DO SERVIDOR, NÃO DA BARRA LATERAL
//
// `coordenacoes` deve ser o que a API ecoou de volta, e não o estado do seletor.
// As duas coisas coincidem quando a tela está correta — e quando não coincidem,
// é justamente aí que uma legenda tirada da barra lateral escreveria na imagem
// um recorte que nunca foi aplicado ao número.

import { Coordenacao } from "@/types";
import { COORDENACOES } from "@/lib/metas-periodo";

export interface ContextoExport {
	/** O que o gráfico mostra. Começa o nome do arquivo. */
	titulo: string;
	/** Recorte temporal já formatado (`descricaoPeriodo`). */
	periodo: string;
	/** Coordenações que o SERVIDOR aplicou. Vazio = todas. */
	coordenacoes: Coordenacao[];
	/** Quando a FONTE foi lida (ISO). Não é quando a imagem foi gerada. */
	dadoDe?: string | null;
}

export const TODAS = "Todas as coordenações";

/**
 * Lista vazia e lista cheia significam a mesma coisa — nenhum recorte — e
 * precisam dizer isso com todas as letras. Uma imagem que simplesmente omite a
 * linha deixa o leitor decidir se o filtro estava ligado ou se ninguém pensou
 * nisso.
 */
export function rotuloCoordenacoes(coords: Coordenacao[]): string {
	if (coords.length === 0 || coords.length >= COORDENACOES.length) return TODAS;
	// Ordem fixa: duas exportações do mesmo recorte não podem gerar rótulos
	// diferentes só porque o usuário clicou nos botões em outra sequência.
	const ordenadas = COORDENACOES.filter((c) => coords.includes(c));
	return ordenadas.join(" + ");
}

/**
 * Idade da fonte, em texto curto. `null` não vira silêncio: "sem carga
 * registrada" é uma informação, ausência de linha não é.
 */
export function rotuloDadoDe(iso?: string | null): string {
	if (!iso) return "sem carga registrada";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "sem carga registrada";
	const data = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
	const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
	return `dado de ${data} ${hora}`;
}

export function legendaDaImagem(ctx: ContextoExport): {
	recorte: string;
	procedencia: string;
} {
	return {
		recorte: rotuloCoordenacoes(ctx.coordenacoes),
		procedencia: `Fluxo · Dashboard Comercial · ${rotuloDadoDe(ctx.dadoDe)}`,
	};
}

// ─── Nome do arquivo ──────────────────────────────────────────────

function semAcento(s: string): string {
	return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function fatiar(s: string): string {
	return semAcento(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function carimbo(agora: Date): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return (
		`${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}` +
		`-${p(agora.getHours())}${p(agora.getMinutes())}`
	);
}

/**
 * O nome do arquivo é a segunda cópia da legenda — e a que sobrevive quando a
 * imagem é encaminhada sem contexto nenhum. Por isso repete o recorte inteiro,
 * inclusive o período, que na imagem aparece só no selo.
 */
export function nomeDoArquivo(ctx: ContextoExport, agora = new Date()): string {
	const partes = [ctx.titulo, ctx.periodo, rotuloCoordenacoes(ctx.coordenacoes)]
		.map(fatiar)
		.filter(Boolean);
	return `${partes.join("_")}_${carimbo(agora)}.png`;
}
