// Tela de metas por coordenação: quanto do ciclo cada uma já vendeu e faturou
// contra a própria meta. Uma linha por coordenação, na cor dela.
//
// A cor de identidade vai só na barra e no marcador, nunca no texto: o amarelo
// da ACE some sobre branco. Percentual não ganha verde/vermelho de alerta —
// a governança de colors.ts proíbe misturar identidade e alerta no mesmo contexto;
// o tracejado "hoje" é a referência de ritmo.

import { FileText, TrendingUp } from "lucide-react";

import type { TvCoordenacao, TvCoordenacoes } from "@/lib/tv";
import { NomeDoCiclo } from "./Contexto";
import { COR, NUMERO, corDa, pct, reaisCurto } from "./formato";

function Celula({ valor, pendente = 0, alvo, cor, hoje }: { valor: number; pendente?: number; alvo: number | null; cor: string; hoje: number }) {
	if (!alvo) {
		return <div style={{ flex: 1, fontSize: 26, color: COR.terciario }}>sem meta no ciclo</div>;
	}
	const c = Math.min(valor / alvo, 1) * 100;
	const p = Math.min(pendente / alvo, 1 - c / 100) * 100;
	return (
		<div style={{ flex: 1, display: "flex", alignItems: "center", gap: 32 }}>
			<span style={{ ...NUMERO, width: 170, fontSize: 64, fontWeight: 600, color: COR.texto, letterSpacing: -1.5, textAlign: "right" }}>
				{pct(valor / alvo)}
			</span>
			<div style={{ flex: 1 }}>
				<div style={{ position: "relative", height: 22, borderRadius: 11, background: "#F1F1F1", overflow: "hidden" }}>
					<div style={{ position: "absolute", inset: 0, width: `${c}%`, background: cor, borderRadius: 11 }} />
					{p > 0 && (
						<div style={{ position: "absolute", top: 0, bottom: 0, left: `${c}%`, width: `${p}%`, background: `${cor}55` }} />
					)}
				</div>
				<div style={{ position: "relative", height: 0 }}>
					<div style={{ position: "absolute", left: `${hoje * 100}%`, top: -30, height: 38, borderLeft: `2px dashed ${COR.terciario}` }} />
				</div>
				<div style={{ ...NUMERO, marginTop: 14, fontSize: 24, color: COR.secundario }}>
					{reaisCurto(valor)} <span style={{ color: COR.terciario }}>de {reaisCurto(alvo)}</span>
					{pendente > 0 && <span style={{ color: COR.terciario }}> · {reaisCurto(pendente)} a faturar</span>}
				</div>
			</div>
		</div>
	);
}

function Linha({ c, hoje }: { c: TvCoordenacao; hoje: number }) {
	const cor = corDa(c.coordenacao);
	return (
		<div style={{ flex: 1, display: "flex", alignItems: "center", gap: 72, borderTop: `1px solid ${COR.linha}` }}>
			<div style={{ width: 200, display: "flex", alignItems: "center", gap: 20 }}>
				<div style={{ width: 18, height: 64, borderRadius: 9, background: cor }} />
				<span style={{ fontSize: 48, fontWeight: 600, color: COR.texto, letterSpacing: 1 }}>{c.coordenacao}</span>
			</div>
			<Celula valor={c.vendido} alvo={c.metaVendas} cor={cor} hoje={hoje} />
			<Celula valor={c.faturado} pendente={c.aFaturar} alvo={c.metaFaturamento} cor={cor} hoje={hoje} />
		</div>
	);
}

export function CoordenacoesTv({ dados }: { dados: TvCoordenacoes }) {
	const cabecalho = (texto: string, Icone: typeof TrendingUp) => (
		<div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, paddingLeft: 202 }}>
			<Icone size={22} color={COR.terciario} strokeWidth={1.5} />
			<span style={{ fontSize: 24, fontWeight: 500, color: COR.secundario }}>{texto}</span>
		</div>
	);
	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "40px 64px 32px" }}>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
				<span style={{ fontSize: 30, fontWeight: 500, color: COR.texto }}>
					<NomeDoCiclo rotulo={dados.ciclo} tamanho={30} />
				</span>
				<span style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 22, color: COR.terciario }}>
					<span style={{ height: 24, borderLeft: `2px dashed ${COR.terciario}` }} />
					onde o ciclo está hoje ({pct(dados.hojeNoCiclo)})
				</span>
			</div>
			<div style={{ display: "flex", gap: 72, paddingBottom: 16 }}>
				<div style={{ width: 200 }} />
				{cabecalho("meta de vendas", TrendingUp)}
				{cabecalho("meta de faturamento", FileText)}
			</div>
			<div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
				{dados.coordenacoes.map((c) => (
					<Linha key={c.coordenacao} c={c} hoje={dados.hojeNoCiclo} />
				))}
			</div>
		</div>
	);
}
