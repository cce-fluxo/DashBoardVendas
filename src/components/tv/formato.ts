// Formatação e tipografia do painel de TV. Valores do Figma Make
// (vMPbgU4OPKh16hHZZVJfXf, guidelines/Dashboard_Fluxo_Especificacoes.md).

import type { CSSProperties } from "react";

import { COORD } from "@/lib/colors";

export const COR = {
	texto: "#111111",
	secundario: "#6B6B6B",
	// Mais escuro que o Figma (#9B9B9B): a TV da sede é antiga e lava o cinza.
	terciario: "#858585",
	linha: "#E8E8E8",
	marca: "#F58332",
} as const;

/** Inter com dígitos tabulares: sem isso o número "treme" quando atualiza. */
export const NUMERO: CSSProperties = {
	fontFamily: "var(--fonte-numero), sans-serif",
	fontVariantNumeric: "tabular-nums",
};

export function reaisCurto(n: number): string {
	if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace(".", ",")}M`;
	return `R$ ${Math.round(n / 1_000)}k`;
}

export function pct(v: number, casas = 0): string {
	return `${(v * 100).toFixed(casas).replace(".", ",")}%`;
}

/** "AAAA-MM-DD" como data LOCAL. `new Date("2026-10-05")` seria UTC e recuaria um dia. */
function dataLocal(iso: string): Date {
	const [a, m, d] = iso.split("-").map(Number);
	return new Date(a, m - 1, d);
}

/** `dias` vem do servidor (TvFechado.diasAtras); null = só se sabe o mês. */
export function haQuanto(iso: string, dias: number | null): string {
	if (dias === null) return `em ${mesCurto(iso)}`;
	const d = dias;
	if (d <= 0) return "hoje";
	if (d === 1) return "ontem";
	return `há ${d} dias`;
}

export function dataCurta(iso: string, exata: boolean): string {
	if (!exata) return mesCurto(iso);
	return dataLocal(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

function mesCurto(iso: string): string {
	return dataLocal(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
}

export function contratos(n: number): string {
	return n === 1 ? "1 contrato" : `${n} contratos`;
}

/** Cor de identidade da coordenação (src/lib/colors.ts); rótulo desconhecido fica neutro. */
export function corDa(coordenacao: string): string {
	return COORD[coordenacao as keyof typeof COORD] ?? COR.terciario;
}
