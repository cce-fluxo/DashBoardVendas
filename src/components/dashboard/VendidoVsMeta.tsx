"use client";

import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	Tooltip,
	ResponsiveContainer,
	ReferenceLine,
	Cell,
	LabelList,
	type LabelProps,
	type TooltipContentProps,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { BRAND } from "@/lib/colors";

interface VendidoVsMetaProps {
	meta: number;
	atual: number;
	anterior?: number | null;
	loading?: boolean;
}

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

function TooltipCustom({ active, payload }: Partial<TooltipContentProps<number, string>>) {
	if (!active || !payload?.length) return null;
	const d = payload[0].payload as { nome: string; valor: number };
	return (
		<div className="bg-popover border border-foreground/10 rounded-lg px-3 py-2 text-xs">
			<p className="text-foreground/50 mb-1">{d.nome}</p>
			<p className="text-foreground font-semibold">{formatarReais(d.valor)}</p>
		</div>
	);
}

function LabelValor({ x, y, width, height, value }: LabelProps) {
	return (
		<text
			x={Number(x) + Number(width) + 8}
			y={Number(y) + Number(height) / 2}
			fill="var(--muted-foreground)"
			fontSize={11}
			dominantBaseline="middle"
		>
			{formatarReais(Number(value))}
		</text>
	);
}

export function VendidoVsMeta({
	meta,
	atual,
	anterior,
	loading = false,
}: VendidoVsMetaProps) {
	if (loading) {
		return <Skeleton className="h-40 w-full bg-foreground/[0.05] rounded-xl" />;
	}

	const dados = [
		{ nome: "Gestão Atual", valor: atual, cor: BRAND.laranja },
		...(anterior != null
			? [{ nome: "Gestão Anterior", valor: anterior, cor: "var(--muted-foreground)" }]
			: []),
	];

	const maximo = Math.max(meta, atual, anterior ?? 0) * 1.12 || 1;

	return (
		<ResponsiveContainer width="100%" height={Math.max(140, dados.length * 70)}>
			<BarChart
				data={dados}
				layout="vertical"
				margin={{ top: 22, right: 96, left: 0, bottom: 8 }}
				barCategoryGap="35%"
			>
				<XAxis
					type="number"
					domain={[0, maximo]}
					tickFormatter={formatarCompacto}
					tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
					axisLine={false}
					tickLine={false}
				/>
				<YAxis
					type="category"
					dataKey="nome"
					width={96}
					tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
					axisLine={false}
					tickLine={false}
				/>
				<Tooltip content={<TooltipCustom />} cursor={{ fill: "var(--muted)" }} />
				{meta > 0 && (
					<ReferenceLine
						x={meta}
						stroke={BRAND.laranja}
						strokeDasharray="4 4"
						label={(props: LabelProps) => {
							// Rótulo ancorado à ESQUERDA da linha (cresce para dentro do
							// gráfico) para não ser cortado quando a meta fica perto da borda.
							const { viewBox } = props;
							if (!viewBox || !("x" in viewBox)) return null;
							return (
								<text
									x={viewBox.x - 6}
									y={viewBox.y + 11}
									textAnchor="end"
									fill="var(--muted-foreground)"
									fontSize={10}
								>
									{`Meta ${formatarReais(meta)}`}
								</text>
							);
						}}
					/>
				)}
				<Bar dataKey="valor" radius={[0, 4, 4, 0]} maxBarSize={22}>
					{dados.map((d, i) => (
						<Cell key={i} fill={d.cor} />
					))}
					<LabelList dataKey="valor" content={<LabelValor />} />
				</Bar>
			</BarChart>
		</ResponsiveContainer>
	);
}
