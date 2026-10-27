// Contrato novo toma a TV por 12 s: confete, projeto, valor contando e quem
// vendeu. Só visual — som em TV exige autoplay liberado no navegador, e a
// decisão foi não depender disso. Quem decide o que é novo: fechadosNovos (tv.ts).

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { COORD } from "@/lib/colors";
import type { TvFechado } from "@/lib/tv";
import { Rosto } from "./Rosto";
import { COR, NUMERO, corDa, reaisCurto } from "./formato";

const DURACAO_MS = 12_000;
const SAIDA_MS = 800;
const CONTAGEM_MS = 2_000;
const INICIO_CONTAGEM_MS = 600;

const CORES = [...Object.values(COORD), "#FFFFFF", "#FFFFFF"];

/** Pseudoaleatório fixo: o confete é o mesmo a cada render, sem Math.random no corpo. */
function sorteio(i: number, k: number): number {
	const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
	return x - Math.floor(x);
}

const CONFETE = Array.from({ length: 90 }, (_, i) => ({
	left: sorteio(i, 1) * 1920,
	largura: 10 + sorteio(i, 2) * 10,
	altura: 16 + sorteio(i, 3) * 14,
	duracao: 3 + sorteio(i, 4) * 3,
	atraso: sorteio(i, 5) * 3,
	cor: CORES[Math.floor(sorteio(i, 6) * CORES.length)],
}));

const KEYFRAMES = `
@keyframes comemoracao-entrar { from { opacity: 0; transform: scale(1.04) } to { opacity: 1; transform: scale(1) } }
@keyframes comemoracao-cair { from { transform: translateY(-60px) rotate(0deg) } to { transform: translateY(1140px) rotate(720deg) } }
@keyframes comemoracao-surgir { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
`;

/** Valor subindo de 0 ao total, desacelerando no fim. */
function useContagem(total: number): number {
	const [valor, setValor] = useState(0);
	useEffect(() => {
		let quadro = 0;
		const inicio = performance.now() + INICIO_CONTAGEM_MS;
		const passo = (agora: number) => {
			const t = Math.min(1, Math.max(0, (agora - inicio) / CONTAGEM_MS));
			setValor(total * (1 - (1 - t) ** 3));
			if (t < 1) quadro = requestAnimationFrame(passo);
		};
		quadro = requestAnimationFrame(passo);
		return () => cancelAnimationFrame(quadro);
	}, [total]);
	return valor;
}

const surgir = (atrasoS: number) => ({ animation: `comemoracao-surgir 0.6s ${atrasoS}s ease-out both` });

export function Comemoracao({ f, aoTerminar }: { f: TvFechado; aoTerminar: () => void }) {
	const valor = useContagem(f.valor);
	const [saindo, setSaindo] = useState(false);

	useEffect(() => {
		const sair = setTimeout(() => setSaindo(true), DURACAO_MS - SAIDA_MS);
		const fim = setTimeout(aoTerminar, DURACAO_MS);
		return () => {
			clearTimeout(sair);
			clearTimeout(fim);
		};
	}, [aoTerminar]);

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				zIndex: 10,
				overflow: "hidden",
				background: COR.marca,
				color: "#FFFFFF",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 36,
				padding: "0 110px",
				animation: "comemoracao-entrar 0.6s ease-out both",
				opacity: saindo ? 0 : 1,
				transition: `opacity ${SAIDA_MS}ms ease-in`,
			}}
		>
			<style>{KEYFRAMES}</style>

			{CONFETE.map((c, i) => (
				<span
					key={i}
					style={{
						position: "absolute",
						top: 0,
						left: c.left,
						width: c.largura,
						height: c.altura,
						borderRadius: 3,
						background: c.cor,
						animation: `comemoracao-cair ${c.duracao}s ${c.atraso}s linear infinite both`,
					}}
				/>
			))}

			<span style={{ ...surgir(0.2), display: "flex", alignItems: "center", gap: 14, padding: "14px 32px", borderRadius: 999, background: "rgba(255,255,255,0.2)", fontSize: 38, fontWeight: 700, letterSpacing: "0.02em" }}>
				<Sparkles size={36} color="#FFFFFF" strokeWidth={2} />
				novo contrato!
			</span>

			<span style={{ ...surgir(0.4), maxWidth: "100%", fontSize: 128, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
				{f.projeto}
			</span>

			<div style={{ ...surgir(0.5), display: "flex", alignItems: "center", gap: 20, minWidth: 0, maxWidth: "100%" }}>
				<span style={{ padding: "6px 22px", borderRadius: 999, background: "#FFFFFF", color: corDa(f.coordenacao), fontSize: 34, fontWeight: 800, letterSpacing: "0.04em", flexShrink: 0 }}>
					{f.coordenacao}
				</span>
				{f.cliente !== f.projeto && (
					<span style={{ fontSize: 38, color: "rgba(255,255,255,0.85)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
						{f.cliente}
					</span>
				)}
			</div>

			<span style={{ ...NUMERO, ...surgir(0.6), fontSize: 220, fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 0.9 }}>
				{reaisCurto(valor)}
			</span>

			{f.responsaveis.length > 0 && (
				// Nome embaixo da foto: lado a lado, foto grande não cabe com 4 pessoas.
				<div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: "20px 64px", flexWrap: "wrap", marginTop: 12 }}>
					{f.responsaveis.map((p, i) => (
						<div key={p.nome} style={{ ...surgir(1.2 + i * 0.3), display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
							<Rosto p={p} tamanho={180} anel="#FFFFFF" borda={6} />
							<span style={{ fontSize: 40, fontWeight: 700 }}>{p.nome}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
