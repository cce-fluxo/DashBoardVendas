// Tela de metas: faixa do ciclo (vendas e faturamento por mês), evolução do
// faturamento na gestão e os números do mês. Desenho: GoalsScreen do Figma Make.
//
// Diferenças do Figma, de propósito:
// - a linha tracejada do gráfico é o PREVISTO da planilha, não meta — meta de
//   faturamento só existe para outubro, e uma linha de um ponto não diz nada;
// - mês sem meta mostra "sem meta" e barra vazia: "?????" na planilha não é meta zero.
// - sem hover/tooltip: é TV.

import { FileText, TrendingUp } from "lucide-react";

import type { TvMetaMes, TvMetas } from "@/lib/tv";
import { NomeDoCiclo, TiraDeContexto } from "./Contexto";
import { COR, NUMERO, pct, reaisCurto } from "./formato";

const fracao = (v: number | null, alvo: number | null) => (v !== null && alvo ? v / alvo : 0);

function Trilho({ cheio, pendente = 0, cor, altura = 10 }: { cheio: number; pendente?: number; cor: string; altura?: number }) {
	const c = Math.min(cheio, 1) * 100;
	const p = Math.min(pendente, 1 - Math.min(cheio, 1)) * 100;
	return (
		<div style={{ flex: 1, height: altura, borderRadius: 4, background: "#F1F1F1", overflow: "hidden", position: "relative" }}>
			<div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${c}%`, background: cor }} />
			{p > 0 && <div style={{ position: "absolute", top: 0, height: "100%", left: `${c}%`, width: `${p}%`, background: "#DADADA" }} />}
		</div>
	);
}

function Faixa({ m }: { m: TvMetas }) {
	const rotulo = (texto: string, Icone: typeof TrendingUp) => (
		<div style={{ height: 16, display: "flex", alignItems: "center", gap: 8 }}>
			<Icone size={16} color={COR.terciario} strokeWidth={1.5} />
			<span style={{ fontSize: 20, fontWeight: 500, color: COR.secundario }}>{texto}</span>
		</div>
	);
	// Realizado contra a meta do mês; sem meta, a barra fica vazia.
	const cheioVendas = (x: TvMetaMes) => (x.metaVendas ? x.vendido / x.metaVendas : 0);
	const alvoFat = (x: TvMetaMes) => x.metaFaturamento ?? x.previsto;
	const vendasAcum = m.meses.reduce((s, x) => s + x.vendido, 0);
	const fatAcum = m.meses.reduce((s, x) => s + (x.faturado ?? 0), 0);
	const prevAcum = m.meses.reduce((s, x) => s + (x.previsto ?? 0), 0);

	return (
		<div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
			<div style={{ display: "flex", gap: 8, marginBottom: 28 }}>
				<div style={{ width: 170, flexShrink: 0 }} />
				{m.meses.map((x, i) => (
					<span key={x.abrev} style={{ flex: 1, fontSize: 24, fontWeight: i === m.mesAtual ? 600 : 400, color: i === m.mesAtual ? COR.texto : COR.terciario }}>
						{x.abrev}
					</span>
				))}
			</div>
			<div style={{ display: "flex", gap: 8 }}>
				<div style={{ width: 170, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
					{rotulo("vendas", TrendingUp)}
					{rotulo("faturamento", FileText)}
				</div>
				<div style={{ flex: 1, position: "relative" }}>
					<div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
						{m.meses.map((x, i) => (
							<Trilho key={x.abrev} cheio={i > m.mesAtual ? 0 : cheioVendas(x)} cor={i === m.mesAtual ? COR.marca : COR.texto} />
						))}
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						{m.meses.map((x, i) => (
							<Trilho
								key={x.abrev}
								cheio={i > m.mesAtual ? 0 : fracao(x.faturado, alvoFat(x))}
								pendente={i === m.mesAtual ? fracao(Math.max(0, (x.previsto ?? 0) - (x.faturado ?? 0)), alvoFat(x)) : 0}
								cor={COR.texto}
							/>
						))}
					</div>
					<div style={{ position: "absolute", left: `${m.hojeNoCiclo * 100}%`, top: 0, width: 2, height: 26, background: "#C53030", transform: "translateX(-1px)" }}>
						<span style={{ position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", fontSize: 18, fontWeight: 500, color: "#C53030" }}>
							hoje
						</span>
					</div>
				</div>
			</div>
			<p style={{ ...NUMERO, fontSize: 22, color: COR.terciario, margin: "16px 0 0" }}>
				acumulado · vendas {reaisCurto(vendasAcum)}
				{m.metaVendasCiclo !== null && ` de ${reaisCurto(m.metaVendasCiclo)}`}
				{"  ·  "}faturado {reaisCurto(fatAcum)}
				{m.metaFaturamentoCiclo !== null ? ` de ${reaisCurto(m.metaFaturamentoCiclo)}` : ` de ${reaisCurto(prevAcum)} previsto`}
			</p>
		</div>
	);
}

function Grafico({ m }: { m: TvMetas }) {
	const g = m.grafico;
	const max = Math.max(1, ...g.map((p) => Math.max(p.previsto ?? 0, p.realizado ?? 0))) * 1.2;
	const x = (i: number) => (i / (g.length - 1)) * 100;
	const y = (v: number) => 8 + (1 - v / max) * 92;
	const linha = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? "L" : "M"}${a},${b}`).join(" ");
	const prev = g.flatMap((p, i) => (p.previsto === null ? [] : [[x(i), y(p.previsto)] as [number, number]]));
	const real = g.flatMap((p, i) => (p.realizado === null ? [] : [[x(i), y(p.realizado)] as [number, number]]));
	const totalReal = g.reduce((s, p) => s + (p.realizado ?? 0), 0);

	return (
		<div style={{ flex: 1, background: "#FFF", borderRadius: 12, boxShadow: "0 2px 24px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)", padding: "18px 24px 12px", display: "flex", flexDirection: "column" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
					<p style={{ fontSize: 22, fontWeight: 500, color: COR.texto, margin: 0 }}>Evolução de faturamento</p>
					<span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16, color: COR.terciario }}>
						<span style={{ width: 16, height: 2, background: COR.marca }} /> realizado
					</span>
					<span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16, color: COR.terciario }}>
						<svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke="#B0B0B0" strokeWidth="2" strokeDasharray="3,2" /></svg> previsto
					</span>
				</div>
				<p style={{ ...NUMERO, fontSize: 26, fontWeight: 700, color: COR.texto, margin: 0 }}>{reaisCurto(totalReal)}</p>
			</div>
			<div style={{ flex: 1, position: "relative", minHeight: 0 }}>
				<svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: "0 0 24px 0", width: "100%", height: "calc(100% - 24px)" }}>
					<defs>
						<linearGradient id="fatFundo" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stopColor={COR.marca} stopOpacity="0.16" />
							<stop offset="100%" stopColor={COR.marca} stopOpacity="0" />
						</linearGradient>
					</defs>
					<line x1={x(m.mesAtualNaGestao)} y1="8" x2={x(m.mesAtualNaGestao)} y2="100" stroke="#E0E0E0" strokeWidth="0.4" strokeDasharray="1.5,1" />
					{real.length > 1 && <path d={`${linha(real)} L${real[real.length - 1][0]},100 L${real[0][0]},100 Z`} fill="url(#fatFundo)" />}
					<path d={linha(prev)} fill="none" stroke="#B0B0B0" strokeWidth="2.5" strokeDasharray="8,6" vectorEffect="non-scaling-stroke" />
					{real.length > 1 && <path d={linha(real)} fill="none" stroke={COR.marca} strokeWidth="3" vectorEffect="non-scaling-stroke" />}
				</svg>
				{/* Pontos em HTML: círculo num SVG com preserveAspectRatio="none" vira elipse. */}
				<div style={{ position: "absolute", inset: "0 0 24px 0" }}>
					{real.map(([a, b], i) => (
						<span key={i} style={{ position: "absolute", left: `${a}%`, top: `${b}%`, width: 12, height: 12, borderRadius: 6, background: COR.marca, transform: "translate(-50%,-50%)" }} />
					))}
				</div>
				<div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 24, display: "flex", justifyContent: "space-between" }}>
					{g.map((p, i) => (
						<span key={p.abrev} style={{ width: 0, display: "flex", justifyContent: "center", fontSize: 15, color: i === m.mesAtualNaGestao ? COR.texto : COR.terciario, fontWeight: i === m.mesAtualNaGestao ? 600 : 400 }}>
							{p.abrev}
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

function Coluna({ rotulo, Icone, valor, alvo, pendente, cor }: { rotulo: string; Icone: typeof TrendingUp; valor: number; alvo: number | null; pendente: number; cor: string }) {
	return (
		<div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "36px 64px" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
				<Icone size={24} color={COR.terciario} strokeWidth={1.5} />
				<p style={{ fontSize: 28, fontWeight: 500, color: COR.texto, margin: 0 }}>{rotulo}</p>
			</div>
			<div style={{ display: "flex", alignItems: "baseline", gap: 24 }}>
				<p style={{ ...NUMERO, fontSize: 104, fontWeight: 700, letterSpacing: "-0.04em", color: cor, margin: 0, lineHeight: 1 }}>{reaisCurto(valor)}</p>
				<p style={{ ...NUMERO, fontSize: 30, color: COR.terciario, margin: 0 }}>{alvo ? `/ ${reaisCurto(alvo)}` : "sem meta"}</p>
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				<div style={{ display: "flex" }}>
					<Trilho cheio={fracao(valor, alvo)} pendente={fracao(pendente, alvo)} cor={cor} altura={14} />
				</div>
				<p style={{ ...NUMERO, fontSize: 24, color: COR.terciario, margin: 0 }}>
					{alvo ? pct(valor / alvo) : "—"}
					{alvo && pendente > 0 ? ` · +${pct(pendente / alvo)} a faturar` : ""}
				</p>
			</div>
		</div>
	);
}

export function MetasTv({ metas: m }: { metas: TvMetas }) {
	const mes = m.meses[m.mesAtual];
	const pendente = Math.max(0, (mes.previsto ?? 0) - (mes.faturado ?? 0));
	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "40px 64px 24px" }}>
				<span style={{ fontSize: 30, fontWeight: 500, color: COR.texto }}>
					<NomeDoCiclo rotulo={m.ciclo} tamanho={30} />
				</span>
				<span style={{ ...NUMERO, fontSize: 24, color: COR.terciario }}>
					semana {m.semana} de {m.semanas} · faltam {m.faltamDias} dias
				</span>
			</div>
			<div style={{ display: "flex", padding: "0 64px", gap: 40, height: 300 }}>
				<Faixa m={m} />
				<Grafico m={m} />
			</div>
			<div style={{ height: 1, background: COR.linha, margin: "36px 64px 0" }} />
			<div style={{ flex: 1, minHeight: 0, display: "flex" }}>
				<Coluna rotulo={`vendas de ${mes.nome}`} Icone={TrendingUp} valor={mes.vendido} alvo={mes.metaVendas} pendente={0} cor={COR.marca} />
				<div style={{ width: 1, background: COR.linha, margin: "40px 0" }} />
				{/* Sem meta de faturamento, o alvo é o previsto: é o que a planilha promete. */}
				<Coluna
					rotulo={`faturamento de ${mes.nome}`}
					Icone={FileText}
					valor={mes.faturado ?? 0}
					alvo={mes.metaFaturamento ?? mes.previsto}
					pendente={pendente}
					cor={COR.texto}
				/>
			</div>
			<TiraDeContexto
				itens={[
					{ rotulo: "ritmo atual", valor: `${reaisCurto(m.ritmoSemana)}/sem` },
					{ rotulo: "precisa por semana", valor: m.precisaSemana === null ? "sem meta" : `${reaisCurto(m.precisaSemana)}/sem` },
					{ rotulo: "em propostas abertas", valor: reaisCurto(m.propostasAbertas) },
				]}
			/>
		</div>
	);
}
