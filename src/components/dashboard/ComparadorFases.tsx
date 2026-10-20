"use client";

import { useState } from "react";
import { EtapaFunil, ComparadorFasesResultado } from "@/types";
import { BRAND } from "@/lib/colors";

// ─── Configuração ───────────────────────────────────────────────────

const ETAPAS: EtapaFunil[] = [
	"Oportunidade",
	"Contato aberto",
	"Pré-diagnóstico feito",
	"Diagnóstico feito",
	"Precificação/Aprovação em andamento",
	"Proposta comercial feita",
	"Follow-up",
	"Venda",
];

// Conversão entre fases não tem limite bom/ruim universal → acento neutro de marca.

// ─── Componente ──────────────────────────────────────────────────────

interface ComparadorFasesProps {
	resultado: ComparadorFasesResultado | null;
	onComparar: (etapaDe: EtapaFunil, etapaPara: EtapaFunil) => void;
	loading?: boolean;
}

export function ComparadorFases({
	resultado,
	onComparar,
	loading = false,
}: ComparadorFasesProps) {
	const [etapaDe, setEtapaDe] = useState<EtapaFunil>("Diagnóstico feito");
	const [etapaPara, setEtapaPara] = useState<EtapaFunil>("Venda");

	const indexDe = ETAPAS.indexOf(etapaDe);
	// "Para" só pode ser uma etapa posterior a "De"
	const opcoesParaEtapa = ETAPAS.filter((_, i) => i > indexDe);

	function handleEtapaDeChange(nova: EtapaFunil) {
		setEtapaDe(nova);
		const novoIndex = ETAPAS.indexOf(nova);
		// Se a etapa "Para" atual ficou inválida, ajusta para a próxima disponível
		if (ETAPAS.indexOf(etapaPara) <= novoIndex) {
			const proxima = ETAPAS[novoIndex + 1] ?? ETAPAS[ETAPAS.length - 1];
			setEtapaPara(proxima);
		}
	}

	const cor = BRAND.laranja;

	return (
		<div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 md:p-5 flex flex-col gap-4">
			<div className="flex items-center justify-between flex-wrap gap-2">
				<span className="text-sm font-medium text-foreground/80">
					Comparador de fases
				</span>
				<span className="text-[10px] text-foreground/30">
					% de cards que, ao passarem pela etapa inicial, chegaram à etapa final
				</span>
			</div>

			<div className="flex items-center gap-3 flex-wrap">
				{/* Seletor "De" */}
				<div className="flex flex-col gap-1">
					<label className="text-[10px] text-foreground/40 uppercase tracking-wide">
						De
					</label>
					<select
						value={etapaDe}
						onChange={(e) => handleEtapaDeChange(e.target.value as EtapaFunil)}
						className="bg-foreground/[0.04] border border-foreground/10 rounded-lg px-3 py-2 text-sm text-foreground/80 outline-none focus:border-foreground/30 transition-colors"
					>
						{ETAPAS.slice(0, -1).map((etapa) => (
							<option key={etapa} value={etapa} className="bg-popover text-popover-foreground">
								{etapa}
							</option>
						))}
					</select>
				</div>

				{/* Seta */}
				<div className="flex items-center pt-5">
					<svg width="20" height="12" viewBox="0 0 20 12" fill="none">
						<path
							d="M0 6H18M18 6L12 0M18 6L12 12"
							stroke="var(--border)"
							strokeWidth="1.5"
						/>
					</svg>
				</div>

				{/* Seletor "Para" */}
				<div className="flex flex-col gap-1">
					<label className="text-[10px] text-foreground/40 uppercase tracking-wide">
						Para
					</label>
					<select
						value={etapaPara}
						onChange={(e) => setEtapaPara(e.target.value as EtapaFunil)}
						className="bg-foreground/[0.04] border border-foreground/10 rounded-lg px-3 py-2 text-sm text-foreground/80 outline-none focus:border-foreground/30 transition-colors"
					>
						{opcoesParaEtapa.map((etapa) => (
							<option key={etapa} value={etapa} className="bg-popover text-popover-foreground">
								{etapa}
							</option>
						))}
					</select>
				</div>

				{/* Botão comparar */}
				<button
					onClick={() => onComparar(etapaDe, etapaPara)}
					disabled={loading}
					className="self-end px-4 py-2 rounded-lg text-sm font-medium bg-foreground/10 hover:bg-foreground/15 text-foreground/90 border border-foreground/10 transition-colors disabled:opacity-50"
				>
					{loading ? "Calculando..." : "Comparar"}
				</button>
			</div>

			{/* Etapa que o pipe de origem não media: 0,0% seria mentira. */}
			{resultado?.naoInstrumentadas?.length ? (
				<div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
					<p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
						<span className="font-semibold">Sem medição neste período. </span>
						{resultado.naoInstrumentadas.join(" e ")}{" "}
						{resultado.naoInstrumentadas.length > 1 ? "não existiam" : "não existia"}{" "}
						no CRM da época — os cards não deixaram de passar por{" "}
						{resultado.naoInstrumentadas.length > 1 ? "elas" : "ela"}, a fase não
						estava lá. Escolha outra etapa para comparar.
					</p>
				</div>
			) : null}

			{/* Resultado */}
			{resultado && !resultado.naoInstrumentadas?.length && (
				<div
					className="flex items-center justify-between gap-4 rounded-xl px-4 py-3 border"
					style={{ backgroundColor: `${cor}15`, borderColor: `${cor}35` }}
				>
					<div className="flex flex-col gap-0.5 min-w-0">
						<span className="text-xs text-foreground/60 truncate">
							{resultado.etapaDe} → {resultado.etapaPara}
						</span>
						<span className="text-[10px] text-foreground/30">
							{resultado.chegaramNaEtapaPara} de {resultado.totalNaEtapaDe}{" "}
							cards
						</span>
					</div>
					<span className="text-2xl font-bold shrink-0" style={{ color: cor }}>
						{resultado.percentual.toFixed(1)}%
					</span>
				</div>
			)}
		</div>
	);
}
