"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
	LineChart,
	Line,
	XAxis,
	YAxis,
	Tooltip,
	ResponsiveContainer,
	CartesianGrid,
	type TooltipContentProps,
} from "recharts";
import { BRAND } from "@/lib/colors";

// ─── Tipos ───────────────────────────────────────────────────────

interface PontoMes {
	mes: string;
	label: string;
	totalVendido: number;
	numeroDeVendas: number;
}

interface SalesOverTimeProps {
	dados: PontoMes[];
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

function formatarCompacto(valor: number) {
	if (valor >= 1000) return `${Math.round(valor / 1000)}k`;
	return String(valor);
}

// ─── Tooltip ─────────────────────────────────────────────────────

function TooltipCustom({ active, payload }: Partial<TooltipContentProps<number, string>>) {
	if (!active || !payload?.length) return null;
	const d = payload[0].payload as PontoMes;
	return (
		<div className="bg-popover border border-foreground/10 rounded-lg px-3 py-2 text-xs">
			<p className="text-foreground/50 mb-1">{d.label}</p>
			<p className="text-foreground font-semibold">
				{formatarReais(d.totalVendido)}
			</p>
			<p className="text-foreground/40">
				{d.numeroDeVendas} venda{d.numeroDeVendas !== 1 ? "s" : ""}
			</p>
		</div>
	);
}

// ─── Componente ──────────────────────────────────────────────────

export function SalesOverTime({ dados, loading = false }: SalesOverTimeProps) {
	if (loading) {
		return <Skeleton className="h-56 w-full bg-foreground/[0.05] rounded-xl" />;
	}

	const temDados = dados?.some((d) => d.totalVendido > 0);
	if (!temDados) {
		return (
			<div className="flex items-center justify-center h-56 border border-dashed border-foreground/10 rounded-xl">
				<p className="text-sm text-foreground/40">
					Sem vendas no período da gestão
				</p>
			</div>
		);
	}

	return (
		<ResponsiveContainer width="100%" height={240}>
			<LineChart data={dados} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
				<CartesianGrid
					strokeDasharray="3 3"
					stroke="var(--border)"
					vertical={false}
				/>
				<XAxis
					dataKey="label"
					tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
					axisLine={false}
					tickLine={false}
				/>
				<YAxis
					tickFormatter={formatarCompacto}
					tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
					axisLine={false}
					tickLine={false}
					width={36}
				/>
				<Tooltip content={<TooltipCustom />} cursor={{ stroke: "var(--border)" }} />
				<Line
					type="monotone"
					dataKey="totalVendido"
					stroke={BRAND.laranja}
					strokeWidth={2.5}
					dot={{ r: 3, fill: BRAND.laranja, strokeWidth: 0 }}
					activeDot={{ r: 5 }}
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}
