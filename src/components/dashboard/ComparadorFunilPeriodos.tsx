"use client";

// ComparadorFunilPeriodos.tsx
//
// Comparador periódico de funil (F1): compara o funil de DUAS coortes (períodos)
// lado a lado. Semântica de coorte fechada + janela equalizada (ver
// calculations-funil.ts). KPIs de volume/tempo com delta acima dos dois funis.

import { useState } from "react";
import {
	SelecaoPeriodoFunil,
	ComparativoFunilPeriodos,
	FunilPeriodo,
	EtapaFunil,
} from "@/types";
import { PeriodSelector } from "./PeriodSelector";
import { FunnelChartConversao, FunnelChartTempo } from "./FunnelChartV2";
import { ALERT } from "@/lib/colors";
import { gestaoAtual, rotuloCiclo } from "@/lib/periodo-gestao";
import { mesesDisponiveis } from "@/lib/periodos-disponiveis";

// ─── Rótulos ──────────────────────────────────────────────────────

// Havia aqui uma QUARTA cópia do calendário trimestral ("Q1 (Out–Dez)"…), que
// além de errada para 23/24 e 24/25 rotulava o ano do mês pelo primeiro ano da
// gestão — janeiro de 25/26 aparecia como "Jan/25" em vez de "Jan/26".
// Tudo agora vem do registry.

function rotuloPeriodo(sel: SelecaoPeriodoFunil): string {
	if (sel.tipo === "mes" && sel.mes) {
		const opcao = mesesDisponiveis(sel.gestao).find((m) => m.valor === sel.mes);
		return opcao?.rotuloCurto ?? `${sel.mes}/${sel.gestao}`;
	}
	if (sel.tipo === "ciclo" && sel.ciclo) {
		return rotuloCiclo(sel.ciclo, sel.gestao);
	}
	return `Gestão ${sel.gestao}`;
}

/**
 * Defaults do comparador: os dois últimos meses que já aconteceram na gestão
 * vigente. Vinha de `new Date().getMonth()` com a gestão fixa em "25/26" — em
 * outubro isso apontaria para um mês da gestão anterior, e a partir de out/2026
 * para uma gestão que nem é mais a vigente.
 */
function ultimosMesesDisponiveis(): { anterior: string; atual: string } {
	const gestao = gestaoAtual();
	const disponiveis = mesesDisponiveis(gestao).filter(
		(m) => m.estado === "disponivel",
	);
	const atual = disponiveis[disponiveis.length - 1]?.valor ?? "10";
	const anterior = disponiveis[disponiveis.length - 2]?.valor ?? atual;
	return { anterior, atual };
}

// ─── Badge de maturidade ──────────────────────────────────────────

function BadgeMaturidade({ m }: { m: FunilPeriodo["maturidade"] }) {
	if (m.emAndamento)
		return (
			<span
				className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
				title={`Período em andamento — ${m.diasDecorridos} dias decorridos. A coorte ainda não percorreu o funil.`}
			>
				em andamento
			</span>
		);
	if (m.emMaturacao)
		return (
			<span
				className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600/80 dark:text-amber-400/80 border border-amber-500/20"
				title="Coorte recente — pode ainda não ter percorrido o funil até o fim."
			>
				em maturação
			</span>
		);
	return null;
}

// ─── Aviso de período não medido ──────────────────────────────────

/**
 * Fica ACIMA do gráfico, não num tooltip.
 *
 * Um período sem CRM e um período com conversão ruim desenham a mesma barra
 * curta. Quem olhar só o desenho vai concluir a mesma coisa dos dois — e num dos
 * casos vai estar errado. O aviso precisa chegar antes da leitura do gráfico,
 * não depois de alguém passar o mouse procurando explicação.
 */
function AvisoCobertura({ c }: { c: FunilPeriodo["coberturaParcial"] }) {
	if (!c) return null;
	return (
		<div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
			<p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
				<span className="font-semibold">Período parcialmente medido. </span>
				{c.texto}
			</p>
		</div>
	);
}

// ─── KPI comparado ────────────────────────────────────────────────

function fmt(valor: number, formato: "int" | "pct" | "dias"): string {
	if (formato === "pct") return `${valor.toFixed(0)}%`;
	if (formato === "dias") return valor > 0 ? `${valor}d` : "—";
	return String(valor);
}

function KpiComparado({
	label,
	a,
	b,
	delta,
	formato,
	melhorQuando,
}: {
	label: string;
	a: number;
	b: number;
	delta: number;
	formato: "int" | "pct" | "dias";
	melhorQuando: "maior" | "menor";
}) {
	const neutro = Math.abs(delta) < (formato === "pct" ? 0.5 : 0.01);
	const bom = melhorQuando === "maior" ? delta > 0 : delta < 0;
	const cor = neutro ? "var(--muted-foreground)" : bom ? ALERT.good : ALERT.bad;
	const sinal = delta > 0 ? "+" : "";
	const deltaTxt =
		formato === "pct"
			? `${sinal}${delta.toFixed(0)}%`
			: formato === "dias"
				? `${sinal}${delta}d`
				: `${sinal}${delta}`;

	return (
		<div className="flex flex-col gap-1 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-2.5">
			<span className="text-[10px] uppercase tracking-wider text-foreground/30">
				{label}
			</span>
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-sm font-semibold text-foreground tabular-nums">
					{fmt(a, formato)} <span className="text-foreground/30 font-normal">→</span>{" "}
					{fmt(b, formato)}
				</span>
				<span
					className="text-[11px] font-semibold tabular-nums shrink-0"
					style={{ color: cor }}
				>
					{neutro ? "→" : deltaTxt}
				</span>
			</div>
		</div>
	);
}

// ─── Coluna de um período ─────────────────────────────────────────

function ColunaPeriodo({
	periodo,
	deltas,
}: {
	periodo: FunilPeriodo;
	deltas?: Partial<Record<EtapaFunil, number>>;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-2 flex-wrap">
				<span className="text-sm font-semibold text-foreground">
					{rotuloPeriodo(periodo.selecao)}
				</span>
				<BadgeMaturidade m={periodo.maturidade} />
			</div>
			<AvisoCobertura c={periodo.coberturaParcial} />
			<FunnelChartConversao etapas={periodo.conversao.etapas} deltas={deltas} />
			<div className="pt-2">
				<FunnelChartTempo dados={periodo.tempo} />
			</div>
		</div>
	);
}

// ─── Componente principal ─────────────────────────────────────────

interface Props {
	resultado: ComparativoFunilPeriodos | null;
	onComparar: (
		selA: SelecaoPeriodoFunil,
		selB: SelecaoPeriodoFunil,
		equalizar: boolean,
	) => void;
	loading?: boolean;
}

export function ComparadorFunilPeriodos({
	resultado,
	onComparar,
	loading = false,
}: Props) {
	const [selA, setSelA] = useState<SelecaoPeriodoFunil>(() => ({
		tipo: "mes",
		gestao: gestaoAtual(),
		mes: ultimosMesesDisponiveis().anterior,
	}));
	const [selB, setSelB] = useState<SelecaoPeriodoFunil>(() => ({
		tipo: "mes",
		gestao: gestaoAtual(),
		mes: ultimosMesesDisponiveis().atual,
	}));
	const [equalizar, setEqualizar] = useState(true);

	// PeriodSelector emite mudanças parciais; mesclamos no estado do lado.
	function merge(
		set: React.Dispatch<React.SetStateAction<SelecaoPeriodoFunil>>,
		patch: Partial<SelecaoPeriodoFunil>,
	) {
		set((prev) => ({ ...prev, ...patch }));
	}

	return (
		<div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 md:p-5 flex flex-col gap-5">
			{/* Cabeçalho */}
			<div className="flex items-center justify-between flex-wrap gap-2">
				<span className="text-sm font-medium text-foreground/80">
					Comparador periódico de funil
				</span>
				<span className="text-[10px] text-foreground/30 max-w-md text-right">
					Compara a coorte de cards criados em cada período. Conversão e tempo
					refletem cada safra, não o board atual.
				</span>
			</div>

			{/* Seletores A vs B */}
			<div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-start">
				<div className="flex flex-col gap-1.5 min-w-0">
					<label className="text-[10px] text-foreground/40 uppercase tracking-wide">
						Período A
					</label>
					<PeriodSelector
						tipo={selA.tipo}
						gestao={selA.gestao}
						ciclo={selA.ciclo}
						mes={selA.mes}
						onChange={(p) => merge(setSelA, p)}
					/>
				</div>
				<div className="hidden md:flex items-center pt-6 text-foreground/30 text-xs font-medium">
					vs
				</div>
				<div className="flex flex-col gap-1.5 min-w-0">
					<label className="text-[10px] text-foreground/40 uppercase tracking-wide">
						Período B
					</label>
					<PeriodSelector
						tipo={selB.tipo}
						gestao={selB.gestao}
						ciclo={selB.ciclo}
						mes={selB.mes}
						onChange={(p) => merge(setSelB, p)}
					/>
				</div>
			</div>

			{/* Controles */}
			<div className="flex items-center justify-between gap-3 flex-wrap">
				<label className="flex items-center gap-2 cursor-pointer select-none">
					<input
						type="checkbox"
						checked={equalizar}
						onChange={(e) => setEqualizar(e.target.checked)}
						className="accent-primary w-3.5 h-3.5"
					/>
					<span
						className="text-xs text-foreground/70"
						title="Compara os dois períodos na mesma idade (primeiros N dias de cada um). Torna justa a comparação contra um período ainda em andamento."
					>
						Janela equalizada
					</span>
				</label>
				<button
					onClick={() => onComparar(selA, selB, equalizar)}
					disabled={loading}
					className="px-4 py-2 rounded-lg text-sm font-medium bg-foreground/10 hover:bg-foreground/15 text-foreground/90 border border-foreground/10 transition-colors disabled:opacity-50"
				>
					{loading ? "Calculando..." : "Comparar"}
				</button>
			</div>

			{/* Resultado */}
			{resultado && (
				<div className="flex flex-col gap-5">
					{resultado.equalizado && resultado.janelaEqualizada && (
						<p className="text-[10px] text-foreground/40 -mt-2">
							{resultado.janelaEqualizada.modo === "completo" ? (
								<>
									Comparados pelo{" "}
									<span className="text-foreground/70 font-medium">
										total de {resultado.janelaEqualizada.unidade}
									</span>{" "}
									em cada período (janela equalizada).
								</>
							) : (
								<>
									Comparados nos primeiros{" "}
									<span className="text-foreground/70 font-medium">
										{resultado.janelaEqualizada.valor}{" "}
										{resultado.janelaEqualizada.unidade}
									</span>{" "}
									de cada período (janela equalizada).
								</>
							)}
						</p>
					)}

					{/* KPIs de volume/tempo com delta */}
					<div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
						<KpiComparado
							label="Entraram no funil"
							a={resultado.a.volume.entraramFunil}
							b={resultado.b.volume.entraramFunil}
							delta={resultado.deltaVolume.entraramFunil}
							formato="int"
							melhorQuando="maior"
						/>
						<KpiComparado
							label="Chegaram a Venda"
							a={resultado.a.volume.chegaramVenda}
							b={resultado.b.volume.chegaramVenda}
							delta={resultado.deltaVolume.chegaramVenda}
							formato="int"
							melhorQuando="maior"
						/>
						<KpiComparado
							label="Conversão topo→venda"
							a={resultado.a.volume.conversaoTopoVenda}
							b={resultado.b.volume.conversaoTopoVenda}
							delta={resultado.deltaVolume.conversaoTopoVenda}
							formato="pct"
							melhorQuando="maior"
						/>
						<KpiComparado
							label="Tempo médio de venda"
							a={resultado.a.tempo.tempoMedioVendaDias}
							b={resultado.b.tempo.tempoMedioVendaDias}
							delta={
								resultado.b.tempo.tempoMedioVendaDias -
								resultado.a.tempo.tempoMedioVendaDias
							}
							formato="dias"
							melhorQuando="menor"
						/>
					</div>

					{/* Dois funis lado a lado (delta por etapa no lado B) */}
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
						<ColunaPeriodo periodo={resultado.a} />
						<ColunaPeriodo
							periodo={resultado.b}
							deltas={Object.fromEntries(
								resultado.deltaEtapas
									.filter((d) => d.deltaPercentualEtapaAnterior !== undefined)
									.map((d) => [d.etapa, d.deltaPercentualEtapaAnterior]),
							)}
						/>
					</div>
				</div>
			)}
		</div>
	);
}
