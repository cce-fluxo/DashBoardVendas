// Lead novo no Pipefy: faixa por cima do topo da tela por 10 s. Não toma a TV
// como o contrato novo (Comemoracao.tsx) — lead chega várias vezes por dia, e
// a tela de baixo continua girando. Leads que chegam juntos viram uma faixa só
// ("+2"): importar uma lista no Pipefy não pode virar meia hora de faixa.
// Quem decide o que é novo: leadsNovos (tv.ts).

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";

import type { TvLead } from "@/lib/tv";
import { COR, corDa } from "./formato";

const DURACAO_MS = 10_000;
const SAIDA_MS = 600;

export function FaixaDeLead({ leads, aoTerminar }: { leads: TvLead[]; aoTerminar: () => void }) {
	const [saindo, setSaindo] = useState(false);

	useEffect(() => {
		const sair = setTimeout(() => setSaindo(true), DURACAO_MS - SAIDA_MS);
		const fim = setTimeout(aoTerminar, DURACAO_MS);
		return () => {
			clearTimeout(sair);
			clearTimeout(fim);
		};
	}, [aoTerminar]);

	// O mais novo em destaque; os demais só contam.
	const lead = leads[leads.length - 1];
	const outros = leads.length - 1;

	return (
		<div
			style={{
				position: "absolute",
				top: 80,
				left: 0,
				right: 0,
				zIndex: 5,
				height: 140,
				display: "flex",
				alignItems: "center",
				gap: 32,
				padding: "0 64px",
				background: COR.marca,
				color: "#FFFFFF",
				boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
				animation: "faixa-descer 0.6s ease-out both",
				opacity: saindo ? 0 : 1,
				transition: `opacity ${SAIDA_MS}ms ease-in`,
			}}
		>
			<style>{"@keyframes faixa-descer { from { transform: translateY(-100%); opacity: 0 } to { transform: none; opacity: 1 } }"}</style>
			<span style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 28px", borderRadius: 999, background: "rgba(255,255,255,0.2)", fontSize: 34, fontWeight: 700, flexShrink: 0 }}>
				<UserPlus size={34} color="#FFFFFF" strokeWidth={2} />
				{outros > 0 ? `${leads.length} leads novos` : "novo lead!"}
			</span>
			<span style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-0.03em", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
				{lead.nome}
			</span>
			{lead.coordenacao && (
				<span style={{ padding: "6px 22px", borderRadius: 999, background: "#FFFFFF", color: corDa(lead.coordenacao), fontSize: 30, fontWeight: 800, letterSpacing: "0.04em", flexShrink: 0 }}>
					{lead.coordenacao}
				</span>
			)}
			{outros > 0 && <span style={{ fontSize: 34, fontWeight: 600, color: "rgba(255,255,255,0.85)", flexShrink: 0 }}>+{outros}</span>}
		</div>
	);
}
