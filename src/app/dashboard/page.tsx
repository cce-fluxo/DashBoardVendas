"use client";

// src/app/dashboard/page.tsx
//
// Visão geral. Os KPIs de venda vêm de /api/dashboard; o funil e o tempo no
// funil, de /api/dashboard/funil. Os dois gráficos de funil mostram o funil
// GERAL — a análise por coordenação fica em /dashboard/funil.

import { useState, useEffect, useCallback } from "react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { SalesByChannel } from "@/components/dashboard/SalesByChannel";
import { SalesBySeller } from "@/components/dashboard/SalesBySeller";
import { SalesOverTime } from "@/components/dashboard/SalesOverTime";
import { VendidoVsMeta } from "@/components/dashboard/VendidoVsMeta";
import { PeriodComparison } from "@/components/dashboard/PeriodComparison";
import {
	CoordTable,
	COORD_TABLE_AVISO_CROSSSELL,
} from "@/components/dashboard/CoordTable";
import { BadgeOrigem } from "@/components/dashboard/BadgeOrigem";
import { PeriodSelector } from "@/components/dashboard/PeriodSelector";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { IdadeDoDado } from "@/components/dashboard/IdadeDoDado";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, AlertCircle, Menu } from "lucide-react";
import {
	DashboardData,
	Coordenacao,
	KPIsFunilCompleto,
	KPIsEntradaDireta,
} from "@/types";
import {
	FunnelChartConversao,
	FunnelChartTempo,
} from "@/components/dashboard/FunnelChartV2";
import { Exportavel } from "@/components/dashboard/Exportavel";
import { Logo } from "@/components/dashboard/Logo";
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

// ─── Componentes auxiliares ───────────────────────────────────────

function ErroState({
	mensagem,
	onRetry,
}: {
	mensagem: string;
	onRetry: () => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
			<div className="flex items-center gap-2 text-red-400">
				<AlertCircle size={20} />
				<p className="text-sm font-medium">{mensagem}</p>
			</div>
			<button
				onClick={onRetry}
				className="flex items-center gap-2 text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
			>
				<RefreshCw size={12} />
				Tentar novamente
			</button>
		</div>
	);
}

/**
 * Diz quantos projetos a tabela por coordenação NÃO mostra.
 *
 * A soma das linhas pode ser menor que o board por um motivo específico: o
 * campo "Coordenação" do Pipefy é livre, então há card em branco e card com
 * valor fora das cinco ("NP", "AN"). Sem esta linha, esses projetos somem sem
 * deixar rastro — e "não aparece" fica indistinguível de "não existe".
 *
 * Fica DENTRO do card, e por isso viaja na imagem exportada: a ressalva não
 * pode ficar só na tela enquanto o número circula por aí sozinho.
 */
function NotaSemCoordenacao({
	orfaos,
}: {
	orfaos?: DashboardData["negociacoesSemCoordenacao"];
}) {
	if (!orfaos || orfaos.quantidade === 0) return null;

	const projetos =
		orfaos.quantidade === 1 ? "1 projeto" : `${orfaos.quantidade} projetos`;
	const rotulos = orfaos.rotulos.length
		? ` Valores encontrados fora das cinco: ${orfaos.rotulos.join(", ")}.`
		: "";

	return (
		<p className="text-[11px] text-amber-600/90 dark:text-amber-400/90">
			{projetos} em negociação ({formatarReais(orfaos.valor)}) não aparecem em
			nenhuma linha — o campo Coordenação está vazio ou fora das cinco no
			Pipefy.{rotulos}
		</p>
	);
}

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

function FunilSkeleton() {
	return (
		<div className="flex flex-col gap-2">
			{Array.from({ length: 7 }).map((_, i) => (
				<Skeleton key={i} className="h-12 w-full bg-foreground/[0.04] rounded-xl" />
			))}
		</div>
	);
}

// ─── Página principal ─────────────────────────────────────────────

export default function DashboardPage() {
	const {
		data,
		loading,
		error,
		filtros,
		setFiltros,
		refetch,
		atualizarAgora,
		atualizando,
		avisoAtualizacao,
		coordenacoesAtivas,
		toggleCoordenacao,
	} = useDashboardData();

	const [isSidebarOpen, setIsSidebarOpen] = useState(false);

	// Funil novo — buscado independente do dashboard principal
	const [funilData, setFunilData] = useState<KPIsFunilCompleto | null>(null);
	// Recorte que o SERVIDOR aplicou, ecoado pela rota — é o que a legenda da
	// imagem exportada carrega. Ver src/lib/exportar/legenda.ts.
	const [coordsAplicadas, setCoordsAplicadas] = useState<Coordenacao[]>([]);
	const [loadingFunil, setLoadingFunil] = useState(true);

	// O funil da visão geral segue o seletor de período E o filtro de coordenação
	// da barra lateral. Antes não seguia nenhum dos dois: a busca não recebia
	// parâmetro e o `useCallback` tinha dependências vazias, então o gráfico ficava
	// congelado na gestão vigente enquanto o resto da tela mudava em volta.
	const fetchFunil = useCallback(async () => {
		setLoadingFunil(true);
		try {
			const p = new URLSearchParams({
				gestao: filtros.gestao,
				tipo: filtros.tipo,
			});
			if (filtros.ciclo) p.set("ciclo", filtros.ciclo);
			if (filtros.mes) p.set("mes", filtros.mes);
			// 5 de 5 = sem filtro; mandar a lista cheia daria o mesmo resultado, mas
			// deixa a intenção explícita na URL.
			if (coordenacoesAtivas.length < 5)
				p.set("coordenacoes", coordenacoesAtivas.join(","));

			const res = await fetch(`/api/dashboard/funil?${p}`);
			if (!res.ok) throw new Error("Falha ao buscar funil");
			const json: {
				funil: KPIsFunilCompleto;
				entradaDireta: KPIsEntradaDireta;
				coordenacoes: Coordenacao[];
			} = await res.json();
			setFunilData(json.funil);
			setCoordsAplicadas(json.coordenacoes ?? []);
		} catch (err) {
			console.error("[Dashboard] Funil:", err);
		} finally {
			setLoadingFunil(false);
		}
	}, [
		filtros.gestao,
		filtros.tipo,
		filtros.ciclo,
		filtros.mes,
		coordenacoesAtivas,
	]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- busca de dados ao montar e ao trocar filtro. A saída é uma lib de data fetching (SWR/React Query), não um ajuste local.
		fetchFunil();
	}, [fetchFunil]);

	// Vai ao Pipefy e só então recarrega. Antes só relia o banco — que muda de
	// 30 em 30 minutos, quando o cron passa.
	const handleRefetch = useCallback(async () => {
		await atualizarAgora();
		fetchFunil();
	}, [atualizarAgora, fetchFunil]);

	if (error) return <ErroState mensagem={error} onRetry={refetch} />;

	const dadosFiltrados =
		data && coordenacoesAtivas.length < 5
			? filtrarPorCoordenacoes(data, coordenacoesAtivas)
			: data;

	const fat = dadosFiltrados?.vendas;
	const meta = fat?.metaVendas ?? 0;

	const periodoAtivo = descricaoPeriodo(
		filtros.tipo,
		filtros.gestao,
		filtros.ciclo,
		filtros.mes,
	);

	const mostrarVariacao = !!(
		dadosFiltrados?.comparativo.gestaoAnterior &&
		coordenacoesAtivas.length === 5
	);

	// `geral` já vem recortado pelo servidor — período e coordenações aplicados
	// antes do cálculo, não depois.
	const funilGeral = funilData?.geral;

	return (
		<div className="min-h-screen bg-background text-foreground">
			{/* ── Navbar ────────────────────────────────────────────────── */}
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
						{avisoAtualizacao && (
							<span className="hidden lg:block text-[10px] text-foreground/45 max-w-[170px] text-right leading-tight">
								{avisoAtualizacao}
							</span>
						)}
						<button
							onClick={handleRefetch}
							disabled={atualizando || loading || loadingFunil}
							title="Buscar novidades no Pipefy agora"
							aria-label="Atualizar dados a partir do Pipefy"
							className="p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors disabled:opacity-40"
						>
							<RefreshCw
								size={14}
								className={`text-foreground/40 ${atualizando || loading || loadingFunil ? "animate-spin" : ""}`}
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

			{/* ── Sidebar ───────────────────────────────────────────────── */}
			<Sidebar
				coordenacoesAtivas={coordenacoesAtivas}
				onToggleCoordenacao={toggleCoordenacao}
				gestaoAtual={filtros.gestao}
				periodoAtivo={periodoAtivo}
				isOpen={isSidebarOpen}
				onClose={() => setIsSidebarOpen(false)}
			/>

			{/* ── Conteúdo principal ────────────────────────────────────── */}
			<main className="ml-0 md:ml-[220px] mt-[120px] md:mt-16 px-4 md:px-8 py-8 flex flex-col gap-10 max-w-[1400px]">
				<div className="flex items-start justify-between">
					<div>
						<h1 className="text-xl md:text-2xl font-semibold text-foreground">
							Dashboard Comercial Fluxo
						</h1>
						<p className="text-xs md:text-sm text-foreground/40 mt-1">
							Visão consolidada da gestão {filtros.gestao} — performance, funil
							e metas
						</p>
						<div className="mt-2 max-w-2xl">
							<BadgeOrigem origem={data?.origemDosNumeros} />
						</div>
					</div>
				</div>

				{/* ── Seção 1: KPI Cards ──────────────────────────────────── */}
				<section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
					<KpiCard
						titulo="Total Vendido"
						valor={fat ? formatarReais(fat.totalVendido) : "—"}
						variacao={
							mostrarVariacao ? fat?.variacaoVsGestaoAnterior : undefined
						}
						destaque
						loading={loading}
					/>
					<KpiCard
						titulo="Número de Projetos"
						valor={fat ? String(fat.numeroDeVendas) : "—"}
						variacao={
							mostrarVariacao && dadosFiltrados?.comparativo.gestaoAnterior
								? ((dadosFiltrados.comparativo.gestaoAtual.numeroDeVendas -
										dadosFiltrados.comparativo.gestaoAnterior.numeroDeVendas) /
										Math.max(
											dadosFiltrados.comparativo.gestaoAnterior.numeroDeVendas,
											1,
										)) *
									100
								: undefined
						}
						loading={loading}
					/>
					<KpiCard
						titulo="Ticket Médio"
						valor={fat ? formatarReais(fat.ticketMedio) : "—"}
						loading={loading}
					/>
					{/* Período sem meta cadastrada mostra "—" e diz por quê. Exibir 0%
					    ou emprestar a meta anual faria o número parecer real. */}
					<KpiCard
						titulo="Meta de Vendas"
						valor={
							fat && fat.metaDefinida
								? `${fat.percentualMeta.toFixed(1)}%`
								: "—"
						}
						meta={
							fat && fat.metaDefinida
								? {
										percentual: fat.percentualMeta,
										gap:
											fat.gapMeta > 0
												? `Faltam ${formatarReais(fat.gapMeta)}`
												: "Meta atingida ✓",
									}
								: fat
									? { percentual: 0, gap: "Sem meta definida para este período" }
									: undefined
						}
						loading={loading}
					/>
					<KpiCard
						titulo="LTV"
						valor={dadosFiltrados ? formatarReais(dadosFiltrados.ltv.ltv) : "—"}
						descricao={
							dadosFiltrados
								? `Taxa de fidelização: ${(dadosFiltrados.ltv.mediaRenovacoes * 100).toFixed(0)}%`
								: undefined
						}
						loading={loading}
					/>
					<KpiCard
						titulo="Valor a Fechar"
						valor={
							dadosFiltrados
								? formatarReais(
										dadosFiltrados.porCoordenacao.reduce(
											(acc, c) => acc + c.valorAFechar,
											0,
										),
									)
								: "—"
						}
						descricao="⚡ Dado atual · não segue filtro de período"
						loading={loading}
					/>
				</section>

				<Separator className="bg-foreground/[0.06]" />

				{/* ── Seção 1.5: Evolução de vendas (linha) ───────────────── */}
				<section className="flex flex-col gap-4">
					<Exportavel
						subtitulo={`Vendas assinadas por mês — gestão ${filtros.gestao}`}
						contexto={{
							titulo: "Evolução de Vendas",
							periodo: periodoAtivo,
							coordenacoes: coordenacoesAtivas,
							dadoDe: data?.ultimaAtualizacao,
						}}
					>
						<SalesOverTime
							dados={dadosFiltrados?.vendasPorMes ?? []}
							loading={loading}
						/>
					</Exportavel>
				</section>

				<Separator className="bg-foreground/[0.06]" />

				{/* ── Seção 2: Comparativo de gestões ──────────────────────── */}
				{dadosFiltrados?.comparativoAnalitico && (
					<section className="flex flex-col gap-4">
						<SecaoTitulo
							titulo="Comparativo de Gestões"
							subtitulo="Período equivalente e ritmo vs meta"
						/>
						<div className="bg-card border border-foreground/[0.08] rounded-xl p-6">
							<PeriodComparison
								comparativo={dadosFiltrados.comparativoAnalitico}
								loading={loading}
							/>
						</div>
					</section>
				)}

				<Separator className="bg-foreground/[0.06]" />

				{/* ── Seção 3: Vendido vs Meta + Funil ─────────────────────── */}
				<section className="grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-6">
					<div className="flex flex-col gap-6">
						{/* Vendido vs Meta */}
						<Exportavel
							subtitulo="Realizado da gestão frente à meta de vendas"
							contexto={{
								titulo: "Vendido vs Meta",
								periodo: periodoAtivo,
								coordenacoes: coordenacoesAtivas,
								dadoDe: data?.ultimaAtualizacao,
							}}
						>
							<VendidoVsMeta
								meta={meta}
								atual={fat?.totalVendido ?? 0}
								anterior={
									dadosFiltrados?.comparativo.gestaoAnterior?.totalVendido ??
									null
								}
								loading={loading}
							/>
						</Exportavel>

						{/* Vendas por Canal */}
						<Exportavel
							contexto={{
								titulo: "Vendas por Canal de Aquisição",
								periodo: periodoAtivo,
								coordenacoes: coordenacoesAtivas,
								dadoDe: data?.ultimaAtualizacao,
							}}
						>
							<SalesByChannel
								dados={dadosFiltrados?.porCanal ?? []}
								loading={loading}
							/>
						</Exportavel>
					</div>

					{/* Funil de Vendas — novo motor */}
					<Exportavel
						subtitulo="Conversão relativa a Oportunidade"
						contexto={{
							titulo: "Funil de Vendas",
							periodo: periodoAtivo,
							coordenacoes: coordsAplicadas,
							dadoDe: data?.ultimaAtualizacao,
						}}
					>
						{loadingFunil ? (
							<FunilSkeleton />
						) : funilGeral ? (
							<FunnelChartConversao etapas={funilGeral.conversao.etapas} />
						) : (
							<div className="flex items-center justify-center h-48 border border-dashed border-foreground/10 rounded-xl">
								<p className="text-sm text-foreground/40">
									Sem dados para o período selecionado
								</p>
							</div>
						)}
					</Exportavel>
				</section>

				<Separator className="bg-foreground/[0.06]" />

				{/* ── Seção 4: Tabela coordenações ──────────────────────────── */}
				<section className="flex flex-col gap-4">
					<Exportavel
						subtitulo="Consolidado do período selecionado"
						acoes={
							<p className="text-[11px] text-foreground/30 max-w-md text-right">
								{COORD_TABLE_AVISO_CROSSSELL}
							</p>
						}
						contexto={{
							titulo: "Desempenho por Coordenação",
							periodo: periodoAtivo,
							// A tabela é recortada no cliente por `filtrarPorCoordenacoes`,
							// então aqui o recorte é o da barra lateral — e não o eco da
							// rota do funil, que responde por outro cálculo.
							coordenacoes: coordenacoesAtivas,
							dadoDe: data?.ultimaAtualizacao,
						}}
					>
						<CoordTable
							dados={dadosFiltrados?.porCoordenacao ?? []}
							loading={loading}
						/>
						<NotaSemCoordenacao
							orfaos={dadosFiltrados?.negociacoesSemCoordenacao}
						/>
					</Exportavel>
				</section>

				<Separator className="bg-foreground/[0.06]" />

				{/* ── Seção 5: Vendedores + Tempo no funil ─────────────────── */}
				<section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
					<Exportavel
						subtitulo="Top performers do período"
						contexto={{
							titulo: "Vendas por Vendedor",
							periodo: periodoAtivo,
							coordenacoes: coordenacoesAtivas,
							dadoDe: data?.ultimaAtualizacao,
						}}
					>
						<SalesBySeller
							dados={dadosFiltrados?.porVendedor ?? []}
							loading={loading}
						/>
					</Exportavel>

					{/* Tempo no funil — novo motor */}
					<Exportavel
						subtitulo="Da entrada até o fechamento"
						contexto={{
							titulo: "Tempo Médio no Funil",
							periodo: periodoAtivo,
							coordenacoes: coordsAplicadas,
							dadoDe: data?.ultimaAtualizacao,
						}}
					>
						{loadingFunil ? (
							<FunilSkeleton />
						) : funilGeral ? (
							// ← MUDANÇA: FunnelChartTempo com dados completos (hero + fases)
							<FunnelChartTempo dados={funilGeral.tempo} />
						) : (
							<div className="flex items-center justify-center h-48 border border-dashed border-foreground/10 rounded-xl">
								<p className="text-sm text-foreground/40">
									Sem dados para o período selecionado
								</p>
							</div>
						)}
					</Exportavel>
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
