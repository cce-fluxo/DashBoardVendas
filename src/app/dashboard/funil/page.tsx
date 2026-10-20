"use client";

// src/app/dashboard/funil/page.tsx
//
// Página do funil: conversão, tempo, recorte por coordenação, comparador de
// fases e comparador periódico de funil.

import { useState, useEffect, useCallback } from "react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Menu } from "lucide-react";
import { Logo } from "@/components/dashboard/Logo";
import {
	FunnelChartConversao,
	FunnelChartTempo,
} from "@/components/dashboard/FunnelChartV2";
import { Exportavel } from "@/components/dashboard/Exportavel";
import { SeletorCoordenacao } from "@/components/dashboard/SeletorCoordenacao";
import { IdadeDoDado } from "@/components/dashboard/IdadeDoDado";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { ComparadorFases } from "@/components/dashboard/ComparadorFases";
import { ComparadorFunilPeriodos } from "@/components/dashboard/ComparadorFunilPeriodos";
import {
	Coordenacao,
	KPIsFunilCompleto,
	EtapaFunil,
	ComparadorFasesResultado,
	ComparativoFunilPeriodos,
	SelecaoPeriodoFunil,
} from "@/types";
import { descricaoPeriodo } from "@/lib/periodos-disponiveis";

// ─── Skeletons ────────────────────────────────────────────────────

function FunilSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			{Array.from({ length: 8 }).map((_, i) => (
				<Skeleton key={i} className="h-14 w-full bg-foreground/[0.04] rounded-xl" />
			))}
		</div>
	);
}

// ─── Card de Entrada Direta ───────────────────────────────────────

// ─── Página principal ─────────────────────────────────────────────

export default function FunilPage() {
	const {
		filtros,
		setFiltros,
		atualizarAgora,
		atualizando,
		avisoAtualizacao,
		coordenacoesAtivas,
		toggleCoordenacao,
		data: dashboardData,
		loading: loadingDashboard,
	} = useDashboardData();

	const [isSidebarOpen, setIsSidebarOpen] = useState(false);
	const [funilData, setFunilData] = useState<KPIsFunilCompleto | null>(null);
	// Recorte que o SERVIDOR aplicou, ecoado pela rota. A legenda da imagem sai
	// daqui e não do estado da barra lateral: se os dois divergirem, é exatamente
	// aí que uma legenda tirada da tela escreveria um recorte que nunca existiu.
	const [coordsAplicadas, setCoordsAplicadas] = useState<Coordenacao[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [coordSelecionada, setCoordSelecionada] = useState<Coordenacao>("CCE");
	const [resultadoComparador, setResultadoComparador] =
		useState<ComparadorFasesResultado | null>(null);
	const [loadingComparador, setLoadingComparador] = useState(false);
	const [resultadoPeriodos, setResultadoPeriodos] =
		useState<ComparativoFunilPeriodos | null>(null);
	const [loadingPeriodos, setLoadingPeriodos] = useState(false);

	const periodoAtivo = descricaoPeriodo(
		filtros.tipo,
		filtros.gestao,
		filtros.ciclo,
		filtros.mes,
	);

	// Parâmetros do período, compartilhados pelas duas buscas que seguem o
	// seletor. O comparador PERIÓDICO não usa: ele escolhe dois períodos próprios.
	const paramsDoPeriodo = useCallback(() => {
		const p = new URLSearchParams({
			gestao: filtros.gestao,
			tipo: filtros.tipo,
		});
		if (filtros.ciclo) p.set("ciclo", filtros.ciclo);
		if (filtros.mes) p.set("mes", filtros.mes);
		// 5 de 5 = sem recorte; mandar a lista cheia daria o mesmo resultado, mas
		// deixa a intenção explícita na URL.
		if (coordenacoesAtivas.length < 5)
			p.set("coordenacoes", coordenacoesAtivas.join(","));
		return p;
	}, [
		filtros.gestao,
		filtros.tipo,
		filtros.ciclo,
		filtros.mes,
		coordenacoesAtivas,
	]);

	const fetchFunil = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch(`/api/dashboard/funil?${paramsDoPeriodo()}`);
			if (!res.ok) throw new Error("Falha ao buscar dados do funil");
			const json = (await res.json()) as {
				funil: KPIsFunilCompleto;
				coordenacoes: Coordenacao[];
			};
			setFunilData(json.funil);
			setCoordsAplicadas(json.coordenacoes ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Erro desconhecido");
		} finally {
			setLoading(false);
		}
		// A dependência é o que faltava: sem ela o seletor mudava o rótulo e não
		// refazia a busca.
	}, [paramsDoPeriodo]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- busca de dados ao montar e ao trocar filtro. A saída é uma lib de data fetching (SWR/React Query), não um ajuste local.
		fetchFunil();
		// O resultado do comparador de fases foi calculado para o período ANTERIOR.
		// Mantê-lo na tela ao trocar de período deixaria um número obsoleto ao lado
		// de números novos, sem nada indicando a diferença.
		setResultadoComparador(null);
	}, [fetchFunil]);

	const handleComparar = useCallback(
		async (etapaDe: EtapaFunil, etapaPara: EtapaFunil) => {
			setLoadingComparador(true);
			try {
				const params = paramsDoPeriodo();
				params.set("de", etapaDe);
				params.set("para", etapaPara);
				const res = await fetch(`/api/dashboard/comparador-fases?${params}`);
				if (!res.ok) throw new Error("Falha ao calcular comparador");
				const json: ComparadorFasesResultado = await res.json();
				setResultadoComparador(json);
			} catch (err) {
				console.error("[Comparador Fases]", err);
			} finally {
				setLoadingComparador(false);
			}
		},
		[paramsDoPeriodo],
	);

	const handleCompararPeriodos = useCallback(
		async (
			selA: SelecaoPeriodoFunil,
			selB: SelecaoPeriodoFunil,
			equalizar: boolean,
		) => {
			setLoadingPeriodos(true);
			try {
				const params = new URLSearchParams({
					gestaoA: selA.gestao,
					tipoA: selA.tipo,
					gestaoB: selB.gestao,
					tipoB: selB.tipo,
					equalizar: String(equalizar),
				});
				if (selA.ciclo) params.set("cicloA", selA.ciclo);
				if (selA.mes) params.set("mesA", selA.mes);
				if (selB.ciclo) params.set("cicloB", selB.ciclo);
				if (selB.mes) params.set("mesB", selB.mes);

				const res = await fetch(`/api/dashboard/comparador-funil?${params}`);
				if (!res.ok) throw new Error("Falha ao calcular comparativo de períodos");
				const json: ComparativoFunilPeriodos = await res.json();
				setResultadoPeriodos(json);
			} catch (err) {
				console.error("[Comparador Funil Períodos]", err);
			} finally {
				setLoadingPeriodos(false);
			}
		},
		[],
	);

	// Idem visão geral: o clique vai à fonte, não ao banco.
	const handleRefetch = useCallback(async () => {
		await atualizarAgora();
		fetchFunil();
	}, [atualizarAgora, fetchFunil]);

	// A barra lateral define o ESCOPO; este seletor aprofunda dentro dele. Se a
	// lateral desligar a coordenação que estava aberta aqui, a escolha cai na
	// primeira disponível — derivado na renderização, e não por um efeito que
	// sincroniza estado com estado (dois lugares para a mesma verdade).
	const coordEfetiva = coordenacoesAtivas.includes(coordSelecionada)
		? coordSelecionada
		: coordenacoesAtivas[0];

	// Com a lateral restrita a uma coordenação, este funil e o geral passam a ser
	// o mesmo recorte. Dizer isso evita a leitura de que um deles está errado.
	const escopoJaUnico = coordenacoesAtivas.length === 1;

	const dadosCoordenacao = funilData?.porCoordenacao[coordEfetiva];

	return (
		<div className="min-h-screen bg-background text-foreground">
			{/* Navbar */}
			<header className="fixed top-0 left-0 right-0 z-50 border-b border-foreground/[0.06] bg-background/95 backdrop-blur-sm">
				<div className="h-16 flex items-center justify-between gap-4 px-4 md:px-6">
					<div className="flex items-center gap-3 w-auto md:w-[220px] shrink-0">
						<button
							onClick={() => setIsSidebarOpen(!isSidebarOpen)}
							className="p-2 -ml-2 rounded-lg hover:bg-foreground/[0.06] transition-colors md:hidden"
						>
							<Menu size={20} className="text-foreground/70" />
						</button>
						<div className="flex items-center gap-3">
							<Logo className="rounded-lg object-contain md:w-10 md:h-10" />
							<div className="flex flex-col leading-tight">
								<span className="text-sm font-semibold text-foreground">Fluxo</span>
								<span className="text-[10px] text-primary">Comercial</span>
							</div>
						</div>
					</div>
					<div className="hidden md:flex flex-1 justify-center">
						<PeriodSelector
							tipo={filtros.tipo}
							gestao={filtros.gestao}
							ciclo={filtros.ciclo}
							mes={filtros.mes}
							onChange={setFiltros}
						/>
					</div>
					<div className="flex items-center gap-1 md:gap-3 w-auto md:w-[220px] justify-end shrink-0">
						<IdadeDoDado
							ultimaAtualizacao={dashboardData?.ultimaAtualizacao}
							fonteMaisAtrasada={dashboardData?.fonteMaisAtrasada}
							frescor={dashboardData?.frescor}
							dadoVelho={dashboardData?.dadoVelho}
						/>
						<ThemeToggle />
						{avisoAtualizacao && (
							<span className="hidden lg:block text-[10px] text-foreground/45 max-w-[170px] text-right leading-tight">
								{avisoAtualizacao}
							</span>
						)}
						<button
							onClick={handleRefetch}
							disabled={atualizando || loading || loadingDashboard}
							title="Buscar novidades no Pipefy agora"
							aria-label="Atualizar dados a partir do Pipefy"
							className="p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors disabled:opacity-40"
						>
							<RefreshCw
								size={14}
								className={`text-foreground/40 ${atualizando || loading || loadingDashboard ? "animate-spin" : ""}`}
							/>
						</button>
					</div>
				</div>
				<div className="md:hidden px-4 pb-3 flex justify-center border-t border-foreground/[0.04] pt-2">
					<PeriodSelector
						tipo={filtros.tipo}
						gestao={filtros.gestao}
						ciclo={filtros.ciclo}
						mes={filtros.mes}
						onChange={setFiltros}
					/>
				</div>
			</header>

			<Sidebar
				coordenacoesAtivas={coordenacoesAtivas}
				onToggleCoordenacao={toggleCoordenacao}
				gestaoAtual={filtros.gestao}
				periodoAtivo={periodoAtivo}
				isOpen={isSidebarOpen}
				onClose={() => setIsSidebarOpen(false)}
			/>

			<main className="ml-0 md:ml-[220px] mt-[120px] md:mt-16 px-4 md:px-8 py-8 flex flex-col gap-8 max-w-[1400px]">
				<div>
					<h1 className="text-xl md:text-2xl font-semibold text-foreground">
						Funil de Vendas
					</h1>
					<p className="text-xs md:text-sm text-foreground/40 mt-1">
						Conversão relativa a Oportunidade e tempo médio por etapa · gestão{" "}
						{filtros.gestao}
					</p>
				</div>

				{error && (
					<div className="flex items-center justify-center h-24 border border-dashed border-red-500/20 rounded-xl">
						<p className="text-sm text-red-400/70">
							Erro ao carregar dados do funil: {error}
						</p>
					</div>
				)}

				<ComparadorFases
					resultado={resultadoComparador}
					onComparar={handleComparar}
					loading={loadingComparador}
				/>

				<ComparadorFunilPeriodos
					resultado={resultadoPeriodos}
					onComparar={handleCompararPeriodos}
					loading={loadingPeriodos}
				/>

				<Separator className="bg-foreground/[0.06]" />

				{/* Grupo 1 — Funil Geral */}
				<section className="flex flex-col gap-4">
					<h2 className="text-xs font-semibold text-foreground/40 uppercase tracking-widest">
						Funil Geral
					</h2>
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						<Exportavel
							contexto={{
								titulo: "Conversão",
								periodo: periodoAtivo,
								coordenacoes: coordsAplicadas,
								dadoDe: dashboardData?.ultimaAtualizacao,
							}}
						>
							{loading ? (
								<FunilSkeleton />
							) : (
								funilData && (
									<FunnelChartConversao
										etapas={funilData.geral.conversao.etapas}
									/>
								)
							)}
						</Exportavel>

						<Exportavel
							contexto={{
								titulo: "Tempo de Funil",
								periodo: periodoAtivo,
								coordenacoes: coordsAplicadas,
								dadoDe: dashboardData?.ultimaAtualizacao,
							}}
						>
							{loading ? (
								<FunilSkeleton />
							) : (
								// ← MUDANÇA: passa dados completos (não só etapas[])
								funilData && <FunnelChartTempo dados={funilData.geral.tempo} />
							)}
						</Exportavel>
					</div>
				</section>

				<Separator className="bg-foreground/[0.06]" />

				{/* Grupo 2 — Por coordenação */}
				<section className="flex flex-col gap-4">
					<div className="flex items-center justify-between flex-wrap gap-3">
						<div className="flex flex-col gap-1">
							<h2 className="text-xs font-semibold text-foreground/40 uppercase tracking-widest">
								Funil por Coordenação
							</h2>
							{escopoJaUnico && (
								<p className="text-[11px] text-foreground/35">
									A barra lateral já está restrita a {coordEfetiva} — estes
									números repetem os do Funil Geral.
								</p>
							)}
						</div>
						<SeletorCoordenacao
							valor={coordEfetiva}
							onChange={(c) => setCoordSelecionada(c as Coordenacao)}
							disponiveis={coordenacoesAtivas}
						/>
					</div>
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						<Exportavel
							contexto={{
								titulo: `Conversão — ${coordEfetiva}`,
								periodo: periodoAtivo,
								coordenacoes: [coordEfetiva],
								dadoDe: dashboardData?.ultimaAtualizacao,
							}}
						>
							{loading ? (
								<FunilSkeleton />
							) : (
								dadosCoordenacao && (
									<FunnelChartConversao
										etapas={dadosCoordenacao.conversao.etapas}
									/>
								)
							)}
						</Exportavel>

						<Exportavel
							contexto={{
								titulo: `Tempo de Funil — ${coordEfetiva}`,
								periodo: periodoAtivo,
								coordenacoes: [coordEfetiva],
								dadoDe: dashboardData?.ultimaAtualizacao,
							}}
						>
							{loading ? (
								<FunilSkeleton />
							) : (
								// ← MUDANÇA: passa dados completos (não só etapas[])
								dadosCoordenacao && (
									<FunnelChartTempo dados={dadosCoordenacao.tempo} />
								)
							)}
						</Exportavel>
					</div>
				</section>
			</main>

			<footer className="ml-0 md:ml-[220px] border-t border-foreground/[0.04] mt-10">
				<div className="px-4 md:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-2">
					<p className="text-xs text-foreground/20">Dashboard Comercial Fluxo</p>
					<p className="text-xs text-foreground/20 text-center md:text-right">
						Uso interno · Diretoria de Marketing e Vendas
					</p>
				</div>
			</footer>
		</div>
	);
}
