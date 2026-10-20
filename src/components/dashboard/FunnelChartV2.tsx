"use client";

// FunnelChartV2.tsx
//
// Funil de conversão (FunnelChartConversao) e funil de tempo (FunnelChartTempo).
//   - FunnelChartTempo exibe tempoMedioVendaDias em destaque no topo.
//   - "Oportunidade" e "Venda" ficam fora da lista de tempo por fase:
//       Oportunidade → pré-funil, sem fase anterior
//       Venda        → terminal positivo, "tempo em Venda" não tem significado

import { EtapaConversao, EtapaFunil, KPIsFunilTempo } from "@/types";
import { BRAND, ALERT, corVolumeMarca } from "@/lib/colors";

// ─── Escala neutra de marca (sem semáforo) ───────────────────────
// O funil NÃO tem limites bom/ruim universais (depende da fase da empresa),
// então a cor não julga desempenho — apenas reflete volume em tons de laranja.

function formatarTempo(horas: number): { valor: string; unidade: string } {
	if (horas < 24) {
		return { valor: Math.round(horas).toString(), unidade: "horas" };
	}
	const dias = Math.round(horas / 24);
	return { valor: dias.toString(), unidade: dias === 1 ? "dia" : "dias" };
}

// ─── Badge tempo real ─────────────────────────────────────────────

/**
 * Diz QUAL período o bloco está mostrando.
 *
 * Era `BadgeTempoReal`, com o texto "Dados atuais · não segue filtro de período"
 * — e ele era honesto sobre um comportamento que confundia: as quantidades por
 * fase ignoravam o seletor enquanto os percentuais o seguiam, então a mesma tela
 * respondia a duas perguntas sem dizer qual era qual.
 *
 * Agora tudo segue o seletor, e o selo passou a repetir o recorte ativo. Parece
 * redundante com o seletor no topo — e é de propósito: quem rola até o meio da
 * página e olha um gráfico isolado não deveria precisar subir para saber do que
 * ele fala.
 */
export function BadgePeriodo({ periodo }: { periodo: string }) {
	return (
		<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 w-fit">
			<span className="text-[10px] font-medium text-primary">{periodo}</span>
		</div>
	);
}

// ─── Seta conectora ───────────────────────────────────────────────

function Seta() {
	return (
		<div className="flex flex-col items-center">
			<div className="w-px h-3 bg-foreground/20" />
			<svg width="12" height="7" viewBox="0 0 12 7" fill="none">
				<path d="M6 7L0 0H12L6 7Z" fill="var(--muted-foreground)" />
			</svg>
		</div>
	);
}

// ─── Bloco — conversão ────────────────────────────────────────────

// Badge de variação vs período comparado (pontos percentuais na conversão
// etapa-a-etapa). Aqui há referência objetiva (outro período) → cor de alerta
// é permitida: subir conversão = bom (verde), cair = ruim (vermelho).
function DeltaBadge({ delta }: { delta: number }) {
	const neutro = Math.abs(delta) < 0.5;
	const cor = neutro ? "var(--muted-foreground)" : delta > 0 ? ALERT.good : ALERT.bad;
	const sinal = delta > 0 ? "+" : "";
	return (
		<span
			className="text-[9px] md:text-[10px] font-semibold tabular-nums"
			style={{ color: cor }}
			title="Variação na conversão da fase anterior vs período comparado"
		>
			{neutro ? "→" : `${sinal}${delta.toFixed(0)}%`}
		</span>
	);
}

function BlocoConversao({
	label,
	quantidade,
	percentualRelativo,
	percentualEtapaAnterior,
	naoInstrumentada,
	delta,
}: {
	label: string;
	quantidade: number;
	percentualRelativo?: number;
	percentualEtapaAnterior?: number;
	naoInstrumentada?: boolean;
	delta?: number;
}) {
	// Sem percentual por duas razões DIFERENTES, e a distinção importa:
	//   · não instrumentada → a fase não existia no pipe. Não foi medida.
	//   · sem número por outro motivo → tratamento neutro.
	// "Não medido" e "conversão zero" não podem parecer a mesma coisa.
	const semPercentual = percentualRelativo === undefined;
	// Intensidade do laranja proporcional ao volume retido (acumulada). Sem juízo de valor.
	const volume = corVolumeMarca((percentualRelativo ?? 0) / 100);

	return (
		<div
			className="w-full rounded-xl px-4 md:px-5 py-2.5 md:py-3.5 flex items-center justify-between gap-4 border transition-all duration-150 hover:brightness-110"
			style={{
				backgroundColor: semPercentual ? "var(--muted)" : volume.bg,
				borderColor: semPercentual ? "var(--border)" : volume.border,
			}}
		>
			<div className="flex items-center gap-2 md:gap-3 min-w-0">
				<div
					className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full shrink-0"
					style={{
						backgroundColor: semPercentual
							? "var(--muted-foreground)"
							: BRAND.laranja,
					}}
				/>
				<span className="text-xs md:text-sm text-foreground/80 truncate">
					{label}
				</span>
				{naoInstrumentada && (
					<span
						className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0"
						title="Esta fase não existia no CRM que originou os dados deste período. Não é conversão zero — é ausência de medição."
					>
						não medido neste período
					</span>
				)}
			</div>
			<div className="flex items-center gap-2 md:gap-3 shrink-0">
				{semPercentual && naoInstrumentada && (
					<span className="text-sm text-foreground/30" title="Sem medição">
						—
					</span>
				)}
				{!semPercentual && (
					<div className="flex flex-col items-end leading-tight">
						<div className="flex items-center gap-1.5">
							{delta !== undefined && <DeltaBadge delta={delta} />}
							{percentualEtapaAnterior !== undefined && (
								<span
									className="text-[11px] md:text-xs font-semibold text-foreground"
									title="Conversão vinda da fase anterior"
								>
									{percentualEtapaAnterior.toFixed(0)}%
								</span>
							)}
						</div>
						<span
							className="text-[9px] md:text-[10px] text-foreground/35"
							title="Acumulada em relação a Oportunidade (topo do funil)"
						>
							{percentualRelativo.toFixed(0)}% do topo
						</span>
					</div>
				)}
				<span className="text-base md:text-lg font-bold text-foreground">
					{quantidade}
				</span>
			</div>
		</div>
	);
}

// ─── Bloco — tempo por fase ───────────────────────────────────────

function BlocoTempo({
	label,
	horas,
	naoInstrumentada,
}: {
	label: string;
	horas: number;
	naoInstrumentada?: boolean;
}) {
	const { valor, unidade } = formatarTempo(horas);

	return (
		<div className="w-full rounded-xl px-4 md:px-5 py-2.5 md:py-3.5 flex items-center justify-between gap-4 border border-foreground/[0.08] bg-foreground/[0.03] transition-all duration-150 hover:bg-foreground/[0.05]">
			<div className="flex items-center gap-2 md:gap-3 min-w-0">
				<div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full shrink-0 bg-foreground/30" />
				<span className="text-xs md:text-sm text-foreground/80 truncate">
					{label}
				</span>
			</div>
			{/* "0 horas" leria como instantâneo — o oposto de "ninguém mediu". */}
			{naoInstrumentada ? (
				<div className="flex items-center gap-2 shrink-0">
					<span className="text-[10px] md:text-xs text-foreground/35 italic">
						não medido neste período
					</span>
					<span className="text-base md:text-lg font-bold text-foreground/25">
						—
					</span>
				</div>
			) : (
				<div className="flex items-center gap-1 md:gap-1.5 shrink-0">
					<span className="text-base md:text-lg font-bold text-foreground">
						{valor}
					</span>
					<span className="text-[10px] md:text-xs text-foreground/40">
						{unidade}
					</span>
				</div>
			)}
		</div>
	);
}

// ─── Hero — tempo médio de venda ──────────────────────────────────
//
// Métrica principal do funil de tempo. Acento de marca (laranja), sem semáforo:
// não há limite universal de "rápido/lento" — isso depende da fase da empresa.

function HeroTempoVenda({
	dias,
	totalVendas,
}: {
	dias: number;
	totalVendas: number;
}) {
	const amostra = totalVendas === 1 ? "1 venda" : `${totalVendas} vendas`;

	return (
		<div className="w-full rounded-2xl px-5 py-4 flex items-center justify-between gap-4 border border-primary/30 bg-primary/[0.08] mb-1">
			<div className="flex flex-col gap-0.5 min-w-0">
				<span className="text-[10px] uppercase tracking-widest text-foreground/40 font-medium">
					Tempo médio de venda
				</span>
				<span className="text-[10px] text-foreground/25">
					Entrada no funil até fechamento · {amostra}
				</span>
			</div>
			<div className="flex items-baseline gap-1.5 shrink-0">
				<span className="text-3xl font-bold text-primary">
					{dias > 0 ? dias : "—"}
				</span>
				{dias > 0 && (
					<span className="text-sm text-foreground/40">
						{dias === 1 ? "dia" : "dias"}
					</span>
				)}
			</div>
		</div>
	);
}

// ─── Componente: Funil de Conversão ──────────────────────────────

interface FunnelChartConversaoProps {
	etapas: EtapaConversao[];
	// Variação (pp) da conversão etapa-a-etapa vs período comparado, por etapa.
	// Opcional — quando ausente, o funil é exibido normalmente (uso atual).
	deltas?: Partial<Record<EtapaFunil, number>>;
}

export function FunnelChartConversao({
	etapas,
	deltas,
}: FunnelChartConversaoProps) {
	if (!etapas.length) return null;

	return (
		<div className="flex flex-col items-center gap-0">
			{/* Legenda dos dois percentuais */}
			<div className="w-full flex items-center justify-end gap-3 pb-2 text-[9px] md:text-[10px] text-foreground/30">
				<span className="font-semibold text-foreground/45">% da fase anterior</span>
				<span>·</span>
				<span>% do topo (vs Oportunidade)</span>
			</div>
			{etapas.map((etapa, index) => {
				const isLast = index === etapas.length - 1;
				// Largura proporcional ao volume retido (acumulada) → forma de funil.
				// Mínimo de 48% para os rótulos continuarem legíveis nas fases finais.
				//
				// Etapa não medida herda a largura da anterior em vez de virar 100%:
				// um bloco largo no meio do funil leria como "todo mundo passou por
				// aqui", que é o oposto do que aconteceu (ninguém foi medido).
				const anteriorMedida = etapas
					.slice(0, index)
					.reverse()
					.find((e) => e.percentualRelativo !== undefined);
				const pct = etapa.naoInstrumentada
					? (anteriorMedida?.percentualRelativo ?? 100)
					: (etapa.percentualRelativo ?? 100);
				const largura = 48 + 0.52 * Math.max(0, Math.min(100, pct));
				return (
					<div
						key={etapa.etapa}
						className="flex flex-col items-center"
						style={{ width: `${largura}%` }}
					>
						<BlocoConversao
							label={etapa.etapa}
							quantidade={etapa.quantidade}
							percentualRelativo={etapa.percentualRelativo}
							percentualEtapaAnterior={etapa.percentualEtapaAnterior}
							naoInstrumentada={etapa.naoInstrumentada}
							delta={deltas?.[etapa.etapa]}
						/>
						{!isLast && <Seta />}
					</div>
				);
			})}
		</div>
	);
}

// ─── Componente: Funil de Tempo ───────────────────────────────────
//
// Recebe KPIsFunilTempo completo para poder exibir o hero.
// Exclui "Oportunidade" (pré-funil) e "Venda" (terminal) da lista de fases.

interface FunnelChartTempoProps {
	dados: KPIsFunilTempo;
}

export function FunnelChartTempo({ dados }: FunnelChartTempoProps) {
	const ETAPAS_EXCLUIDAS = new Set(["Oportunidade", "Venda"]);

	const etapasComTempo = dados.etapas.filter(
		(e) => !ETAPAS_EXCLUIDAS.has(e.etapa),
	);

	if (!etapasComTempo.length) return null;

	return (
		<div className="flex flex-col items-stretch gap-0">
			{/* Hero: métrica principal */}
			<HeroTempoVenda
				dias={dados.tempoMedioVendaDias}
				totalVendas={dados.totalVendas}
			/>

			<div className="mt-3 mb-1">
				<span className="text-[10px] uppercase tracking-widest text-foreground/30 font-medium">
					Tempo médio por fase
				</span>
			</div>

			{/* Blocos por fase (Contato aberto → Follow-up) */}
			{etapasComTempo.map((etapa, index) => {
				const isLast = index === etapasComTempo.length - 1;
				return (
					<div key={etapa.etapa} className="flex flex-col items-stretch">
						<BlocoTempo
							label={etapa.etapa}
							horas={etapa.tempoMedioHoras}
							naoInstrumentada={etapa.naoInstrumentada}
						/>
						{!isLast && <Seta />}
					</div>
				);
			})}

			{/* Rodapé: tempo até qualquer fechamento (leitura secundária) */}
			{dados.tempoMedioFechamentoDias > 0 && (
				<div className="mt-3 px-4 py-2 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-between">
					<span className="text-[10px] text-foreground/35">
						Tempo médio até fechamento (incl. perdidos/pausados)
					</span>
					<span className="text-xs font-medium text-foreground/40">
						{dados.tempoMedioFechamentoDias}d
					</span>
				</div>
			)}
		</div>
	);
}
