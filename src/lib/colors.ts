// Governança de cores — ver docs/decisoes.md (seção "Interface").
//
// Três papéis, NUNCA misturados no mesmo contexto:
//   1. IDENTIDADE (BRAND/COORD) — absoluta. Diz "quem" (marca, coordenação).
//   2. ALERTA — verde/amarelo/vermelho. Julgamento. SÓ onde há referência objetiva
//      (atingimento de meta, variação vs período equivalente). Nunca no funil isolado.
//   3. NEUTRO DE VOLUME — tons de marca (laranja) por intensidade, sem juízo de valor.
//      Usado no funil de conversão/tempo.

// ─── BRAND (Fluxo) — absoluto ─────────────────────────────────────
export const BRAND = {
	laranja: "#F58332",
	preto: "#010101",
	branco: "#FFFFFF",
} as const;

// ─── COORD (coordenações) — absoluto ──────────────────────────────
export const COORD = {
	CCE: "#FF1FA9", // rosa
	ACE: "#FDDD0F", // amarelo
	MNP: "#ED212F", // vermelho
	QAB: "#03CC4F", // verde
	PRO: "#76348D", // roxo
} as const;

// ─── ALERTA — só com referência objetiva (meta/comparativo) ───────
export const ALERT = {
	good: "#03CC4F",
	medium: "#FDDD0F",
	bad: "#ED212F",
} as const;

// ─── SERIES — séries genéricas (canal, vendedor) ──────────────────
// Sequência derivada da marca, distinta entre si, sem ler como semáforo.
export const SERIES = [
	"#F58332", // laranja Fluxo
	"#76348D", // roxo
	"#FF1FA9", // rosa
	"#03CC4F", // verde
	"#FDDD0F", // amarelo
	"#2DD4A0", // teal complementar
] as const;

// ─── Helpers ──────────────────────────────────────────────────────

// NEUTRO DE VOLUME — laranja de marca com intensidade proporcional a `fracao` (0..1).
// Sem juízo de valor: mais volume = laranja mais forte. Brand é absoluto → vale nos 2 temas.
// Retorna { bg, border } prontos para style inline.
export function corVolumeMarca(fracao: number): { bg: string; border: string } {
	const f = Math.max(0, Math.min(1, fracao));
	const toHexAlpha = (a: number) =>
		Math.round(a * 255)
			.toString(16)
			.padStart(2, "0");
	const bgAlpha = 0.08 + 0.24 * f; // 8% → 32%
	const borderAlpha = 0.25 + 0.35 * f; // 25% → 60%
	return {
		bg: `${BRAND.laranja}${toHexAlpha(bgAlpha)}`,
		border: `${BRAND.laranja}${toHexAlpha(borderAlpha)}`,
	};
}
