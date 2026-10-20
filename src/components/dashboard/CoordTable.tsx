import { useState, Fragment } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { KPIsPorCoordenacao, Coordenacao } from "@/types";
import { COORD } from "@/lib/colors";
import { ChevronDown, ChevronRight } from "lucide-react";

// ─── Tipos ───────────────────────────────────────────────────────

interface CoordTableProps {
	dados: KPIsPorCoordenacao[];
	loading?: boolean;
	totalVendidoGeral?: number; // KPI geral da página — usado no total da tabela para evitar divergência
}

// ─── Utilitários ─────────────────────────────────────────────────

function formatarReais(valor: number) {
	return valor.toLocaleString("pt-BR", {
		style: "currency",
		currency: "BRL",
		maximumFractionDigits: 0,
	});
}

// ─── Sub-componentes ──────────────────────────────────────────────

function BadgeCoord({ coord }: { coord: Coordenacao }) {
	const cor = COORD[coord];
	return (
		<span
			className="inline-flex items-center px-1.5 md:px-2.5 py-0.5 rounded-full text-[10px] md:text-xs font-medium border"
			style={{
				backgroundColor: `${cor}15`,
				color: cor,
				borderColor: `${cor}30`,
			}}
		>
			{coord}
		</span>
	);
}

function BarraMetaInline({ percentual }: { percentual: number }) {
	const cor =
		percentual >= 80 ? "#03CC4F" : percentual >= 50 ? "#FDDD0F" : "#ED212F";

	return (
		<div className="flex items-center gap-2 min-w-[100px] md:min-w-[120px]">
			<div className="flex-1 h-1.5 rounded-full bg-foreground/[0.08] overflow-hidden">
				<div
					className="h-full rounded-full transition-all duration-500"
					style={{
						width: `${Math.min(percentual, 100)}%`,
						backgroundColor: cor,
					}}
				/>
			</div>
			<span
				className="text-[10px] md:text-xs font-medium w-8 md:w-10 text-right shrink-0"
				style={{ color: cor }}
			>
				{percentual.toFixed(0)}%
			</span>
		</div>
	);
}

// ─── Cálculo de totais (compartilhado entre tabela e cards mobile) ─

function calcularTotais(
	dados: KPIsPorCoordenacao[],
	totalVendidoGeral?: number,
) {
	const metaTotal = dados.reduce((acc, d) => acc + d.metaVendas, 0);

	// Deduplica cross-sell pelo id_card para não contar o mesmo projeto duas vezes no total
	const todosProjetosUnicos = new Map<number, { valor: number }>();
	dados.forEach((coord) => {
		coord.projetosEmNegociacao.forEach((p) => {
			if (!todosProjetosUnicos.has(p.id_card)) {
				todosProjetosUnicos.set(p.id_card, { valor: p.valor });
			}
		});
	});
	const totalAFechar = Array.from(todosProjetosUnicos.values()).reduce(
		(acc, p) => acc + p.valor,
		0,
	);

	// Usa totalVendidoGeral quando disponível — evita divergência com o KPI principal.
	const totalVendido =
		totalVendidoGeral ?? dados.reduce((acc, d) => acc + d.totalVendido, 0);
	const totalProjetos = dados.reduce((acc, d) => acc + d.numeroDeVendas, 0);
	const totalOportunidades = dados.reduce(
		(acc, d) => acc + d.oportunidadesNoFunil,
		0,
	);
	const ticketGeral = totalProjetos > 0 ? totalVendido / totalProjetos : 0;
	const percentualMeta = metaTotal > 0 ? (totalVendido / metaTotal) * 100 : 0;

	return {
		totalVendido,
		totalProjetos,
		totalAFechar,
		totalOportunidades,
		ticketGeral,
		percentualMeta,
	};
}

// ─── Linha de totais (desktop) ────────────────────────────────────

function LinhaTotal({
	dados,
	totalVendidoGeral,
}: {
	dados: KPIsPorCoordenacao[];
	totalVendidoGeral?: number;
}) {
	const {
		totalVendido,
		totalProjetos,
		totalAFechar,
		totalOportunidades,
		ticketGeral,
		percentualMeta,
	} = calcularTotais(dados, totalVendidoGeral);

	return (
		<tr className="border-t border-foreground/[0.12] bg-foreground/[0.04]">
			<td className="px-3 md:px-4 py-3">
				<span className="text-[10px] md:text-xs font-semibold text-foreground/60 uppercase tracking-wider">
					Total
				</span>
			</td>
			<td className="px-3 md:px-4 py-3 text-right">
				<span className="text-xs md:text-sm font-semibold text-foreground whitespace-nowrap">
					{formatarReais(totalVendido)}
				</span>
			</td>
			<td className="px-3 md:px-4 py-3 text-right">
				<span className="text-xs md:text-sm font-semibold text-foreground">
					{totalProjetos}
				</span>
			</td>
			<td className="px-3 md:px-4 py-3 text-right">
				<span className="text-xs md:text-sm font-semibold text-foreground whitespace-nowrap">
					{formatarReais(ticketGeral)}
				</span>
			</td>
			<td className="px-3 md:px-4 py-3 text-right">
				<span className="text-xs md:text-sm font-semibold text-foreground whitespace-nowrap">
					{formatarReais(totalAFechar)}
				</span>
			</td>
			<td className="px-3 md:px-4 py-3 text-right">
				<span className="text-xs md:text-sm font-semibold text-foreground">
					{totalOportunidades}
				</span>
			</td>
			<td className="px-3 md:px-4 py-3">
				<BarraMetaInline percentual={percentualMeta} />
			</td>
		</tr>
	);
}

// ─── Skeleton ────────────────────────────────────────────────────

function TableSkeleton() {
	return (
		<div className="overflow-hidden rounded-xl border border-foreground/[0.08]">
			<div className="flex gap-4 px-4 py-3 border-b border-foreground/[0.08]">
				{Array.from({ length: 7 }).map((_, i) => (
					<Skeleton key={i} className="h-3 flex-1 bg-foreground/10" />
				))}
			</div>
			{Array.from({ length: 5 }).map((_, i) => (
				<div
					key={i}
					className="flex gap-4 px-4 py-4 border-b border-foreground/[0.06]"
				>
					{Array.from({ length: 7 }).map((_, j) => (
						<Skeleton key={j} className="h-3 flex-1 bg-foreground/[0.06]" />
					))}
				</div>
			))}
		</div>
	);
}

// ─── Componente principal ─────────────────────────────────────────

// Aviso de cross-sell exibido abaixo do subtítulo no componente pai
export const COORD_TABLE_AVISO_CROSSSELL =
	"Leads de cross-sell aparecem individualmente para as coordenações participantes, " +
	"mas são contabilizados somente uma vez no valor total a fechar.";

export function CoordTable({
	dados,
	loading = false,
	totalVendidoGeral,
}: CoordTableProps) {
	const [expandedCoord, setExpandedCoord] = useState<Coordenacao | null>(null);

	if (loading) return <TableSkeleton />;

	if (!dados?.length) {
		return (
			<div className="flex items-center justify-center h-32 border border-dashed border-foreground/10 rounded-xl">
				<p className="text-sm text-foreground/40">
					Sem dados para o período selecionado
				</p>
			</div>
		);
	}

	const toggleRow = (coord: Coordenacao) => {
		setExpandedCoord((prev) => (prev === coord ? null : coord));
	};

	const totais = calcularTotais(dados, totalVendidoGeral);

	return (
		<>
		{/* ── Desktop: tabela ─────────────────────────────────────── */}
		<div className="hidden md:block overflow-x-auto rounded-xl border border-foreground/[0.08]">
			<table className="w-full text-sm">
				{/* Cabeçalho */}
				<thead>
					<tr className="border-b border-foreground/[0.08] bg-foreground/[0.03]">
						{[
							{ label: "Coordenação", align: "left" },
							{ label: "Total Vendido", align: "right" },
							{ label: "Nº Projetos", align: "right" },
							{ label: "Ticket Médio", align: "right" },
							{ label: "Valor a Fechar", align: "right" },
							{ label: "Oport. no Funil", align: "right" },
							{ label: "% Meta", align: "left" },
						].map((col) => (
							<th
								key={col.label}
								className={`
                  px-3 md:px-4 py-3 text-[10px] md:text-xs font-medium uppercase tracking-wider
                  text-foreground/40 whitespace-nowrap
                  text-${col.align}
                `}
							>
								{col.label}
							</th>
						))}
					</tr>
				</thead>

				{/* Corpo */}
				<tbody>
					{dados.map((row, index) => {
						const percentualMeta =
							row.metaVendas > 0
								? (row.totalVendido / row.metaVendas) * 100
								: 0;

						const isExpanded = expandedCoord === row.coordenacao;
						const hasNegociacoes =
							row.projetosEmNegociacao && row.projetosEmNegociacao.length > 0;

						return (
							<Fragment key={row.coordenacao}>
								<tr
									onClick={() => hasNegociacoes && toggleRow(row.coordenacao)}
									className={`
                    border-b border-foreground/[0.06] transition-colors duration-100
                    ${hasNegociacoes ? "cursor-pointer hover:bg-foreground/[0.05]" : "hover:bg-foreground/[0.03]"}
                    ${index % 2 === 0 ? "bg-transparent" : "bg-foreground/[0.02]"}
                  `}
								>
									{/* Coordenação */}
									<td className="px-3 md:px-4 py-4">
										<div className="flex items-center gap-2 md:gap-3">
											{hasNegociacoes ? (
												isExpanded ? (
													<ChevronDown
														size={14}
														className="text-foreground/40 shrink-0"
													/>
												) : (
													<ChevronRight
														size={14}
														className="text-foreground/40 shrink-0"
													/>
												)
											) : (
												<div className="w-[14px] shrink-0" />
											)}
											<div
												className="w-0.5 h-6 md:h-8 rounded-full shrink-0"
												style={{
													backgroundColor: COORD[row.coordenacao],
												}}
											/>
											<BadgeCoord coord={row.coordenacao} />
										</div>
									</td>

									{/* Total Vendido */}
									<td className="px-3 md:px-4 py-4 text-right">
										<span className="text-xs md:text-sm font-medium text-foreground whitespace-nowrap">
											{formatarReais(row.totalVendido)}
										</span>
									</td>

									{/* Nº Projetos */}
									<td className="px-3 md:px-4 py-4 text-right">
										<span className="text-xs md:text-sm text-foreground/80">
											{row.numeroDeVendas}
										</span>
									</td>

									{/* Ticket Médio */}
									<td className="px-3 md:px-4 py-4 text-right">
										<span className="text-xs md:text-sm text-foreground/80 whitespace-nowrap">
											{formatarReais(row.ticketMedio)}
										</span>
									</td>

									{/* Valor a Fechar */}
									<td className="px-3 md:px-4 py-4 text-right">
										<span className="text-xs md:text-sm text-foreground/60 whitespace-nowrap">
											{formatarReais(row.valorAFechar)}
										</span>
									</td>

									{/* Oportunidades no Funil */}
									<td className="px-3 md:px-4 py-4 text-right">
										<span className="text-xs md:text-sm text-foreground/60">
											{row.oportunidadesNoFunil}
										</span>
									</td>

									{/* % Meta com barra inline */}
									<td className="px-3 md:px-4 py-4">
										<BarraMetaInline percentual={percentualMeta} />
									</td>
								</tr>

								{/* Linha expandida */}
								{isExpanded && hasNegociacoes && (
									<tr className="bg-foreground/[0.02] border-b border-foreground/[0.06]">
										<td colSpan={7} className="px-4 md:px-12 py-4">
											<div className="flex flex-col gap-3">
												<p className="text-[10px] md:text-xs font-medium text-foreground/50 uppercase tracking-wider">
													Projetos em negociação (
													{row.projetosEmNegociacao.length})
												</p>
												<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
													{row.projetosEmNegociacao.map((proj, i) => (
														<div
															key={i}
															className="flex flex-col gap-1.5 p-3 rounded-lg bg-card border border-foreground/[0.06]"
														>
															<div className="flex items-start justify-between gap-2">
																<p
																	className="text-xs md:text-sm font-medium text-foreground/90 line-clamp-2"
																	title={proj.titulo}
																>
																	{proj.titulo}
																</p>
																<span className="text-xs md:text-sm font-semibold text-primary shrink-0">
																	{formatarReais(proj.valor)}
																</span>
															</div>
															<span className="text-[9px] md:text-[10px] px-2 py-0.5 rounded-full bg-foreground/[0.04] border border-foreground/[0.04] text-foreground/50 w-fit whitespace-nowrap">
																{proj.etapa}
															</span>
														</div>
													))}
												</div>
											</div>
										</td>
									</tr>
								)}
							</Fragment>
						);
					})}
				</tbody>

				{/* Totais */}
				<tfoot>
					<LinhaTotal dados={dados} totalVendidoGeral={totalVendidoGeral} />
				</tfoot>
			</table>
		</div>

		{/* ── Mobile: cards empilhados ────────────────────────────── */}
		<div className="md:hidden flex flex-col gap-3">
			{dados.map((row) => {
				const percentualMeta =
					row.metaVendas > 0 ? (row.totalVendido / row.metaVendas) * 100 : 0;
				const isExpanded = expandedCoord === row.coordenacao;
				const hasNegociacoes =
					row.projetosEmNegociacao && row.projetosEmNegociacao.length > 0;

				const metricas = [
					{ label: "Total Vendido", valor: formatarReais(row.totalVendido) },
					{ label: "Nº Projetos", valor: String(row.numeroDeVendas) },
					{ label: "Ticket Médio", valor: formatarReais(row.ticketMedio) },
					{ label: "Valor a Fechar", valor: formatarReais(row.valorAFechar) },
					{ label: "Oport. no Funil", valor: String(row.oportunidadesNoFunil) },
				];

				return (
					<div
						key={row.coordenacao}
						className="rounded-xl border border-foreground/[0.08] bg-card overflow-hidden"
					>
						<button
							onClick={() => hasNegociacoes && toggleRow(row.coordenacao)}
							className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
						>
							<div className="flex items-center gap-2.5">
								<div
									className="w-0.5 h-6 rounded-full shrink-0"
									style={{ backgroundColor: COORD[row.coordenacao] }}
								/>
								<BadgeCoord coord={row.coordenacao} />
							</div>
							{hasNegociacoes &&
								(isExpanded ? (
									<ChevronDown size={16} className="text-foreground/40" />
								) : (
									<ChevronRight size={16} className="text-foreground/40" />
								))}
						</button>

						<div className="px-4 pb-4 flex flex-col gap-3">
							<div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
								{metricas.map((m) => (
									<div key={m.label} className="flex flex-col">
										<span className="text-[10px] uppercase tracking-wider text-foreground/40">
											{m.label}
										</span>
										<span className="text-sm font-medium text-foreground">
											{m.valor}
										</span>
									</div>
								))}
							</div>

							<div className="flex flex-col gap-1">
								<span className="text-[10px] uppercase tracking-wider text-foreground/40">
									% Meta
								</span>
								<BarraMetaInline percentual={percentualMeta} />
							</div>

							{isExpanded && hasNegociacoes && (
								<div className="flex flex-col gap-2 pt-1">
									<p className="text-[10px] font-medium text-foreground/50 uppercase tracking-wider">
										Projetos em negociação ({row.projetosEmNegociacao.length})
									</p>
									{row.projetosEmNegociacao.map((proj, i) => (
										<div
											key={i}
											className="flex items-start justify-between gap-2 p-3 rounded-lg bg-foreground/[0.03] border border-foreground/[0.06]"
										>
											<div className="flex flex-col gap-1 min-w-0">
												<p className="text-xs font-medium text-foreground/90 line-clamp-2">
													{proj.titulo}
												</p>
												<span className="text-[9px] px-2 py-0.5 rounded-full bg-foreground/[0.05] text-foreground/50 w-fit">
													{proj.etapa}
												</span>
											</div>
											<span className="text-xs font-semibold text-primary shrink-0">
												{formatarReais(proj.valor)}
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				);
			})}

			{/* Card de total */}
			<div className="rounded-xl border border-foreground/[0.12] bg-foreground/[0.04] px-4 py-3 flex flex-col gap-3">
				<span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/60">
					Total
				</span>
				<div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
					{[
						{ label: "Total Vendido", valor: formatarReais(totais.totalVendido) },
						{ label: "Nº Projetos", valor: String(totais.totalProjetos) },
						{ label: "Ticket Médio", valor: formatarReais(totais.ticketGeral) },
						{ label: "Valor a Fechar", valor: formatarReais(totais.totalAFechar) },
						{ label: "Oport. no Funil", valor: String(totais.totalOportunidades) },
					].map((m) => (
						<div key={m.label} className="flex flex-col">
							<span className="text-[10px] uppercase tracking-wider text-foreground/40">
								{m.label}
							</span>
							<span className="text-sm font-semibold text-foreground">
								{m.valor}
							</span>
						</div>
					))}
				</div>
				<div className="flex flex-col gap-1">
					<span className="text-[10px] uppercase tracking-wider text-foreground/40">
						% Meta
					</span>
					<BarraMetaInline percentual={totais.percentualMeta} />
				</div>
			</div>
		</div>
		</>
	);
}
