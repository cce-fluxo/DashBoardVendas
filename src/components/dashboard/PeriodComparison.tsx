import { ComparativoAnalitico } from "@/types";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// ─── Tipos ───────────────────────────────────────────────────────

interface PeriodComparisonProps {
	comparativo: ComparativoAnalitico | null;
	loading?: boolean;
}

// ─── Utilitários ─────────────────────────────────────────────────

function formatarReais(valor: number) {
	return valor.toLocaleString("pt-BR", {
		style: "currency",
		currency: "BRL",
		maximumFractionDigits: 0,
	});
}

function Variacao({ valor, sufixo = "%" }: { valor: number; sufixo?: string }) {
	const positivo = valor > 0;
	const neutro = Math.abs(valor) < 0.1;
	const Icone = neutro ? Minus : positivo ? TrendingUp : TrendingDown;
	const cor = neutro
		? "text-foreground/40"
		: positivo
			? "text-[#03CC4F]"
			: "text-[#ED212F]";
	const sinal = positivo ? "+" : "";

	return (
		<span className={`flex items-center gap-1 text-[10px] md:text-sm font-semibold ${cor}`}>
			<Icone size={12} className="md:w-3.5 md:h-3.5" />
			{sinal}
			{valor.toFixed(1)}
			{sufixo}
		</span>
	);
}

function LinhaMetrica({
	label,
	valorAtual,
	valorAnterior,
	variacao,
	sufixo,
}: {
	label: string;
	valorAtual: string;
	valorAnterior: string;
	variacao: number;
	sufixo?: string;
}) {
	return (
		<div className="flex flex-col gap-1 px-3 md:px-4 py-2 md:py-3 rounded-lg hover:bg-foreground/[0.03] transition-colors">
			<p className="text-[10px] text-foreground/30 uppercase tracking-wider">
				{label}
			</p>
			<div className="grid grid-cols-[1fr_auto_1fr] gap-2 md:gap-4 items-center">
				<div className="flex flex-col">
					<p className="text-sm md:text-base font-semibold text-foreground">{valorAtual}</p>
				</div>
				<div className="flex items-center justify-center">
					<Variacao valor={variacao} sufixo={sufixo} />
				</div>
				<div className="flex flex-col items-end">
					<p className="text-sm md:text-base font-semibold text-foreground/40">{valorAnterior}</p>
				</div>
			</div>
		</div>
	);
}

// ─── Skeleton ────────────────────────────────────────────────────

function ComparisonSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			<Skeleton className="h-48 bg-foreground/[0.05] rounded-xl" />
			<Skeleton className="h-48 bg-foreground/[0.05] rounded-xl" />
		</div>
	);
}

// ─── Componente principal ─────────────────────────────────────────

export function PeriodComparison({
	comparativo,
	loading = false,
}: PeriodComparisonProps) {
	if (loading) return <ComparisonSkeleton />;

	if (!comparativo) {
		return (
			<div className="flex items-center justify-center h-32 border border-dashed border-foreground/10 rounded-xl">
				<p className="text-sm text-foreground/40">Sem dados para comparação</p>
			</div>
		);
	}

	const { periodoAtual, periodoEquivalente, variacoes, linear } = comparativo;

	return (
		<div className="flex flex-col gap-6">
			{/* ── Bloco 1: vs período equivalente ─────────────────── */}
			{periodoEquivalente && variacoes ? (
				<div className="flex flex-col gap-2">
					{/* Cabeçalho */}
					<div className="grid grid-cols-[1fr_auto_1fr] gap-2 md:gap-4 px-3 md:px-4 pb-2 border-b border-foreground/[0.04] mb-2">
						<div>
							<p className="text-[10px] md:text-xs font-semibold text-primary">
								Atual
							</p>
							<p className="text-[8px] md:text-[10px] text-foreground/30 truncate">
								{periodoAtual.descricao}
							</p>
						</div>
						<div className="flex items-center">
							<p className="text-[8px] md:text-[10px] text-foreground/20 uppercase tracking-widest text-center">
								vs equiv.
							</p>
						</div>
						<div className="text-right">
							<p className="text-[10px] md:text-xs font-semibold text-foreground/40">
								Anterior
							</p>
							<p className="text-[8px] md:text-[10px] text-foreground/20 truncate">
								{periodoEquivalente.descricao}
							</p>
						</div>
					</div>

					{/* Métricas */}
					<LinhaMetrica
						label="Total Vendido"
						valorAtual={formatarReais(periodoAtual.totalVendido)}
						valorAnterior={formatarReais(periodoEquivalente.totalVendido)}
						variacao={variacoes.totalVendido}
					/>
					<LinhaMetrica
						label="Nº de Projetos"
						valorAtual={String(periodoAtual.numeroDeVendas)}
						valorAnterior={String(periodoEquivalente.numeroDeVendas)}
						variacao={variacoes.numeroDeVendas}
					/>
					<LinhaMetrica
						label="Ticket Médio"
						valorAtual={formatarReais(periodoAtual.ticketMedio)}
						valorAnterior={formatarReais(periodoEquivalente.ticketMedio)}
						variacao={variacoes.ticketMedio}
					/>
				</div>
			) : (
				<div className="flex items-center justify-center h-24 border border-dashed border-foreground/10 rounded-xl">
					<p className="text-sm text-foreground/40">
						Sem gestão anterior para comparar
					</p>
				</div>
			)}

			{/* Divisor */}
			<div className="h-px bg-foreground/[0.06]" />

			{/* ── Bloco 2: vs linear da meta ───────────────────────── */}
			<div className="flex flex-col gap-4">
				<div className="flex items-center justify-between gap-4">
					<div className="min-w-0">
						<p className="text-xs font-semibold text-foreground/70">
							Ritmo vs Meta Linear
						</p>
						<p className="text-[10px] text-foreground/30 truncate">
							{linear.mesesDecorridos} de {linear.totalMeses} meses decorridos
						</p>
					</div>
					<div className="text-right shrink-0">
						<p className="text-[10px] text-foreground/30">Projeção anual</p>
						<p className="text-xs md:text-sm font-semibold text-foreground">
							{formatarReais(linear.projecaoAnual)}
						</p>
					</div>
				</div>

				{/* Barras comparativas */}
				<div className="flex flex-col gap-3">
					{[
						{
							label: "Meta Linear",
							valor: linear.metaLinear,
							maximo: Math.max(linear.metaAnual, linear.realizado),
							cor: "bg-foreground/20",
						},
						{
							label: "Realizado",
							valor: linear.realizado,
							maximo: Math.max(linear.metaAnual, linear.realizado),
							cor:
								linear.realizado >= linear.metaLinear
									? "bg-[#03CC4F]"
									: "bg-primary",
						},
						{
							label: "Meta Anual",
							valor: linear.metaAnual,
							maximo: Math.max(linear.metaAnual, linear.realizado),
							cor: "bg-foreground/10",
						},
					].map(({ label, valor, maximo, cor }) => (
						<div key={label} className="flex flex-col gap-1.5">
							<div className="flex justify-between text-[10px] md:text-xs">
								<span className="text-foreground/50">{label}</span>
								<span className="text-foreground font-medium">
									{formatarReais(valor)}
								</span>
							</div>
							<div className="w-full h-2 md:h-2.5 rounded-full bg-foreground/[0.06] overflow-hidden">
								<div
									className={`h-full rounded-full ${cor} transition-all duration-500`}
									style={{ width: `${maximo > 0 ? Math.min((valor / maximo) * 100, 100) : 0}%` }}
								/>
							</div>
						</div>
					))}
				</div>

				{/* Adiantamento/Atraso */}
				<div
					className="flex items-center justify-between px-3 md:px-4 py-2.5 md:py-3 rounded-xl border"
					style={{
						backgroundColor:
							linear.adiantamento >= 0 ? "#03CC4F10" : "#ED212F10",
						borderColor: linear.adiantamento >= 0 ? "#03CC4F30" : "#ED212F30",
					}}
				>
					<p className="text-xs md:text-sm text-foreground/60">
						{linear.adiantamento >= 0
							? "Adiantado vs meta linear"
							: "Atrasado vs meta linear"}
					</p>
					<p
						className="text-sm md:text-base font-bold"
						style={{ color: linear.adiantamento >= 0 ? "#03CC4F" : "#ED212F" }}
					>
						{linear.adiantamento >= 0 ? "+" : ""}
						{formatarReais(linear.adiantamento)}
					</p>
				</div>
			</div>
		</div>
	);
}
