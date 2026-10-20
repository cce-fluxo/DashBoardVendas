"use client";

import { useState } from "react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { IdadeDoDado } from "@/components/dashboard/IdadeDoDado";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Menu } from "lucide-react";
import { KPIsPorCoordenacao, Coordenacao, DashboardData } from "@/types";
import { Logo } from "@/components/dashboard/Logo";
import { COORD } from "@/lib/colors";
import { descricaoPeriodo } from "@/lib/periodos-disponiveis";

// ─── Utilitários ──────────────────────────────────────────────────

function formatarReais(valor: number) {
	return valor.toLocaleString("pt-BR", {
		style: "currency",
		currency: "BRL",
		maximumFractionDigits: 0,
	});
}


// ─── Filtro de dados por coordenações ativas ──────────────────────

function filtrarPorCoordenacoes(
	data: DashboardData,
	coordenacoesAtivas: Coordenacao[],
): DashboardData {
	const coords = new Set(coordenacoesAtivas);
	const porCoordenacao = data.porCoordenacao.filter((c) =>
		coords.has(c.coordenacao),
	);
	const totalVendido = porCoordenacao.reduce(
		(acc, c) => acc + c.totalVendido,
		0,
	);
	const numeroDeVendas = porCoordenacao.reduce(
		(acc, c) => acc + c.numeroDeVendas,
		0,
	);
	const ticketMedio = numeroDeVendas > 0 ? totalVendido / numeroDeVendas : 0;

	return {
		...data,
		porCoordenacao,
		porVendedor: data.porVendedor,
		porCanal: data.porCanal,
		vendas: {
			...data.vendas,
			totalVendido,
			numeroDeVendas,
			ticketMedio,
			percentualMeta:
				data.vendas.metaVendas > 0
					? (totalVendido / data.vendas.metaVendas) * 100
					: 0,
			gapMeta: data.vendas.metaVendas - totalVendido,
			metaDefinida: data.vendas.metaDefinida,
			variacaoVsGestaoAnterior: undefined,
		},
	};
}

// ─── Componentes ─────────────────────────────────────────────────

function SecaoTitulo({
	titulo,
	subtitulo,
}: {
	titulo: string;
	subtitulo?: string;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<h2 className="text-base font-semibold text-foreground">{titulo}</h2>
			{subtitulo && <p className="text-xs text-foreground/40">{subtitulo}</p>}
		</div>
	);
}

function BarraMeta({
	percentual,
	coord,
}: {
	percentual: number;
	coord?: Coordenacao;
}) {
	const cor = coord
		? ""
		: percentual >= 80
			? "bg-emerald-400"
			: percentual >= 50
				? "bg-amber-400"
				: "bg-red-400";

	const corTexto =
		percentual >= 80
			? "text-emerald-400"
			: percentual >= 50
				? "text-amber-400"
				: "text-red-400";

	return (
		<div className="flex items-center gap-3">
			<div className="flex-1 h-2 rounded-full bg-foreground/[0.06] overflow-hidden">
				<div
					className={`h-full rounded-full transition-all duration-500 ${cor}`}
					style={{
						width: `${Math.min(percentual, 100)}%`,
						backgroundColor: coord ? COORD[coord] : undefined,
					}}
				/>
			</div>
			<span
				className={`text-xs font-medium w-10 text-right shrink-0 ${corTexto}`}
			>
				{percentual.toFixed(0)}%
			</span>
		</div>
	);
}

function CardMetaGeral({
	metaVendas,
	totalVendido,
	loading,
}: {
	metaVendas: number;
	totalVendido: number;
	loading: boolean;
}) {
	const percentual =
		metaVendas > 0 ? (totalVendido / metaVendas) * 100 : 0;
	const gap = metaVendas - totalVendido;
	const atingida = gap <= 0;

	return (
		<div className="bg-card border border-foreground/[0.08] rounded-xl p-6 flex flex-col gap-5">
			<div className="flex items-start justify-between">
				<SecaoTitulo
					titulo="Meta de Vendas"
					subtitulo={`Gestão atual — ${atingida ? "meta atingida ✓" : `faltam ${formatarReais(gap)}`}`}
				/>
				{!loading && (
					<span
						className={`text-2xl md:text-3xl font-bold ${
							percentual >= 80
								? "text-emerald-400"
								: percentual >= 50
									? "text-amber-400"
									: "text-red-400"
						}`}
					>
						{percentual.toFixed(1)}%
					</span>
				)}
			</div>
			{loading ? (
				<Skeleton className="h-3 w-full bg-foreground/10 rounded-full" />
			) : (
				<BarraMeta percentual={percentual} />
			)}
			<div className="grid grid-cols-2 gap-4">
				{[
					{ label: "Meta", valor: formatarReais(metaVendas) },
					{ label: "Realizado", valor: formatarReais(totalVendido) },
				].map(({ label, valor }) => (
					<div key={label} className="flex flex-col gap-1">
						<p className="text-[10px] uppercase tracking-widest text-foreground/30">
							{label}
						</p>
						{loading ? (
							<Skeleton className="h-5 w-28 bg-foreground/10" />
						) : (
							<p className="text-lg font-semibold text-foreground">{valor}</p>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

// ─── Tabela de metas por coordenação ─────────────────────────────
//
// MUDANÇA: usa row.metaVendas (meta real por coord, vinda do Supabase)
// em vez de dividir a meta total por número de coordenações.
// Coordenações sem meta definida mostram barra zerada.

function TabelaMetasPorCoord({
	dados,
	loading,
}: {
	dados: KPIsPorCoordenacao[];
	loading: boolean;
}) {
	if (loading) {
		return (
			<div className="flex flex-col gap-3">
				{Array.from({ length: 5 }).map((_, i) => (
					<Skeleton key={i} className="h-16 bg-foreground/[0.05] rounded-xl" />
				))}
			</div>
		);
	}

	if (!dados.length) {
		return (
			<div className="flex items-center justify-center h-32 border border-dashed border-foreground/10 rounded-xl">
				<p className="text-sm text-foreground/40">
					Sem dados para o período selecionado
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			{dados.map((row) => {
				const meta = row.metaVendas;
				const percentual = meta > 0 ? (row.totalVendido / meta) * 100 : 0;
				const gap = meta - row.totalVendido;
				const semMeta = meta === 0;

				return (
					<div
						key={row.coordenacao}
						className="bg-card border border-foreground/[0.08] rounded-xl px-4 py-4 md:px-5 flex flex-col gap-3 hover:border-foreground/[0.16] transition-all"
					>
						<div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
							<div className="flex items-center gap-3">
								<div
									className="w-2 h-2 rounded-full shrink-0"
									style={{ backgroundColor: COORD[row.coordenacao] }}
								/>
								<span className="text-sm font-medium text-foreground">
									{row.coordenacao}
								</span>
							</div>
							<div className="flex items-center gap-4 md:gap-6 text-sm">
								<div className="text-right">
									<p className="text-[10px] text-foreground/30 uppercase tracking-wider">
										Realizado
									</p>
									<p className="font-medium text-foreground">
										{formatarReais(row.totalVendido)}
									</p>
								</div>
								<div className="text-right">
									<p className="text-[10px] text-foreground/30 uppercase tracking-wider">
										Meta
									</p>
									<p className="font-medium text-foreground/60">
										{semMeta ? "—" : formatarReais(meta)}
									</p>
								</div>
								<div className="text-right w-20">
									<p className="text-[10px] text-foreground/30 uppercase tracking-wider">
										Gap
									</p>
									<p
										className={`font-medium ${
											semMeta
												? "text-foreground/30"
												: gap <= 0
													? "text-emerald-400"
													: "text-red-400"
										}`}
									>
										{semMeta ? "—" : gap <= 0 ? "✓" : `- ${formatarReais(gap)}`}
									</p>
								</div>
							</div>
						</div>
						{semMeta ? (
							<p className="text-[10px] text-foreground/25 italic">
								Meta não definida para este período
							</p>
						) : (
							<BarraMeta percentual={percentual} coord={row.coordenacao} />
						)}
					</div>
				);
			})}
		</div>
	);
}

// ─── Página ───────────────────────────────────────────────────────

export default function MetasPage() {
	const {
		data,
		loading,
		filtros,
		setFiltros,
		refetch,
		coordenacoesAtivas,
		toggleCoordenacao,
	} = useDashboardData();

	const [isSidebarOpen, setIsSidebarOpen] = useState(false);

	const periodoAtivo = descricaoPeriodo(
		filtros.tipo,
		filtros.gestao,
		filtros.ciclo,
		filtros.mes,
	);

	const dadosFiltrados =
		data && coordenacoesAtivas.length < 5
			? filtrarPorCoordenacoes(data, coordenacoesAtivas)
			: data;

	const fat = dadosFiltrados?.vendas;
	const metaVendas = fat?.metaVendas ?? 0;
	const totalVendido = fat?.totalVendido ?? 0;

	// Detecta se há metas por coord definidas (pelo menos uma > 0)
	const temMetasPorCoord = (dadosFiltrados?.porCoordenacao ?? []).some(
		(c) => c.metaVendas > 0,
	);

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
							ultimaAtualizacao={data?.ultimaAtualizacao}
							fonteMaisAtrasada={data?.fonteMaisAtrasada}
							frescor={data?.frescor}
							dadoVelho={data?.dadoVelho}
						/>
						<ThemeToggle />
						<button
							onClick={refetch}
							disabled={loading}
							className="p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors disabled:opacity-40"
						>
							<RefreshCw
								size={14}
								className={`text-foreground/40 ${loading ? "animate-spin" : ""}`}
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

			{/* Sidebar */}
			<Sidebar
				coordenacoesAtivas={coordenacoesAtivas}
				onToggleCoordenacao={toggleCoordenacao}
				gestaoAtual={filtros.gestao}
				periodoAtivo={periodoAtivo}
				isOpen={isSidebarOpen}
				onClose={() => setIsSidebarOpen(false)}
			/>

			{/* Conteúdo */}
			<main className="ml-0 md:ml-[220px] mt-[120px] md:mt-16 px-4 md:px-8 py-8 flex flex-col gap-10 max-w-[1400px]">
				<div>
					<h1 className="text-xl md:text-2xl font-semibold text-foreground">
						Metas
					</h1>
					<p className="text-xs md:text-sm text-foreground/40 mt-1">
						Acompanhamento de metas de vendas — gestão {filtros.gestao}
					</p>
				</div>

				{/* Meta geral */}
				<CardMetaGeral
					metaVendas={metaVendas}
					totalVendido={totalVendido}
					loading={loading}
				/>

				<Separator className="bg-foreground/[0.06]" />

				{/* Metas por coordenação */}
				<section className="flex flex-col gap-4">
					<SecaoTitulo
						titulo="Atingimento por Coordenação"
						subtitulo={
							temMetasPorCoord
								? "Meta individual por coordenação"
								: "Metas por coordenação não definidas para este período"
						}
					/>
					<TabelaMetasPorCoord
						dados={dadosFiltrados?.porCoordenacao ?? []}
						loading={loading}
					/>
				</section>

				{!loading && metaVendas === 0 && (
					<div className="flex items-center justify-center h-24 border border-dashed border-foreground/10 rounded-xl">
						<p className="text-sm text-foreground/40">
							Meta não definida para este período — será preenchida no início do
							ciclo
						</p>
					</div>
				)}
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
