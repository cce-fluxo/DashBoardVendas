import { Award, FileSignature } from "lucide-react";

import type { TvRanking, TvVendedor } from "@/lib/tv";
import { TiraDeContexto } from "./Contexto";
import { Rosto } from "./Rosto";
import { COR, NUMERO, contratos, reaisCurto } from "./formato";

type Posicionado = TvVendedor & { posicao: number };

/** Empate em valor E contratos divide a posição. A ordem já vem do servidor. */
function posicionar(vendedores: TvVendedor[]): Posicionado[] {
	let posicao = 1;
	return vendedores.map((v, i) => {
		const a = vendedores[i - 1];
		if (i > 0 && !(a.vendido === v.vendido && a.contratos === v.contratos)) posicao = i + 1;
		return { ...v, posicao };
	});
}

// Degrau por POSIÇÃO (empate divide a posição, então divide o degrau também).
const DEGRAU: Record<number, { altura: number; anel: string; fundo: string; numero: string }> = {
	1: { altura: 120, anel: COR.marca, fundo: "#FDE9DA", numero: COR.marca },
	2: { altura: 80, anel: "#B9BEC4", fundo: "#F1F2F3", numero: "#9AA0A6" },
	3: { altura: 52, anel: "#C8935F", fundo: "#F6EEE6", numero: "#B98455" },
};

function Podio({ v }: { v: Posicionado }) {
	const d = DEGRAU[v.posicao] ?? DEGRAU[3];
	const primeiro = v.posicao === 1;
	return (
		<div style={{ width: 460, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, minWidth: 0 }}>
			<div style={{ position: "relative" }}>
				<Rosto p={v} tamanho={primeiro ? 148 : 108} anel={d.anel} />
				{primeiro && (
					<div style={{ position: "absolute", right: -6, bottom: 4, width: 52, height: 52, borderRadius: "50%", background: COR.marca, display: "flex", alignItems: "center", justifyContent: "center", border: "4px solid #FFFFFF" }}>
						<Award size={26} color="#FFFFFF" strokeWidth={2} />
					</div>
				)}
			</div>
			<span style={{ fontSize: primeiro ? 34 : 28, fontWeight: primeiro ? 600 : 500, color: COR.texto, maxWidth: 440, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
				{v.nome}
			</span>
			<span style={{ ...NUMERO, fontSize: primeiro ? 80 : 56, fontWeight: 700, letterSpacing: "-0.04em", color: primeiro ? COR.marca : COR.texto, lineHeight: 1 }}>
				{reaisCurto(v.vendido)}
			</span>
			<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
				<FileSignature size={22} color={COR.terciario} strokeWidth={1.5} />
				<span style={{ ...NUMERO, fontSize: 22, color: COR.terciario }}>{contratos(v.contratos)}</span>
			</div>
			<div style={{ width: "100%", height: d.altura, marginTop: 6, background: d.fundo, borderTop: `6px solid ${d.anel}`, borderRadius: "12px 12px 0 0", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 8 }}>
				<span style={{ ...NUMERO, fontSize: primeiro ? 64 : 40, fontWeight: 700, letterSpacing: "-0.06em", color: d.numero, lineHeight: 1 }}>
					{v.posicao}º
				</span>
			</div>
		</div>
	);
}

/** Top 3 do histórico: o pódio grande cabe 3 pessoas; o histórico quer mostrar mais gente. */
function Destaque({ v }: { v: Posicionado }) {
	const d = DEGRAU[v.posicao] ?? DEGRAU[3];
	const primeiro = v.posicao === 1;
	return (
		<div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 24, padding: "20px 24px", background: d.fundo, borderTop: `6px solid ${d.anel}`, borderRadius: 12 }}>
			<Rosto p={v} tamanho={104} anel={d.anel} />
			<div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
				<span style={{ ...NUMERO, fontSize: 24, fontWeight: 700, color: d.numero }}>{v.posicao}º</span>
				<span style={{ fontSize: 28, fontWeight: 600, color: COR.texto, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
					{v.nome}
				</span>
				<div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
					<span style={{ ...NUMERO, fontSize: 48, fontWeight: 700, letterSpacing: "-0.04em", color: primeiro ? COR.marca : COR.texto, lineHeight: 1 }}>
						{reaisCurto(v.vendido)}
					</span>
					<span style={{ ...NUMERO, fontSize: 20, color: COR.terciario }}>{contratos(v.contratos)}</span>
				</div>
			</div>
		</div>
	);
}

function Linha({ v, ultima, lateral = 64 }: { v: Posicionado; ultima: boolean; lateral?: number }) {
	return (
		<div>
			<div style={{ display: "flex", alignItems: "center", height: 56, gap: 24, padding: `0 ${lateral}px` }}>
				<span style={{ ...NUMERO, fontSize: 26, fontWeight: 500, color: COR.texto, width: 40 }}>{v.posicao}º</span>
				<span style={{ fontSize: 26, color: COR.texto, flex: 1, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
					{v.nome}
				</span>
				<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
					<FileSignature size={16} color={COR.terciario} strokeWidth={1.5} />
					<span style={{ ...NUMERO, fontSize: 26, color: COR.terciario }}>{v.contratos}</span>
				</div>
				<span style={{ ...NUMERO, fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", color: COR.texto, width: 160, textAlign: "right" }}>
					{reaisCurto(v.vendido)}
				</span>
			</div>
			{!ultima && <div style={{ height: 1, background: COR.linha, margin: `0 ${lateral}px` }} />}
		</div>
	);
}

// Compacto: 3 destaques + 2 colunas de 8 = 19 pessoas.
const POR_COLUNA = 8;

export function RankingTv({ ranking, compacto = false }: { ranking: TvRanking; compacto?: boolean }) {
	const top = posicionar(ranking.vendedores).slice(0, compacto ? 3 + 2 * POR_COLUNA : 6);
	const podio = [top[1], top[0], top[2]].filter(Boolean);
	const lista = top.slice(3);
	const colunas = [lista.slice(0, POR_COLUNA), lista.slice(POR_COLUNA)].filter((c) => c.length > 0);

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<div style={{ display: "flex", justifyContent: "space-between", padding: "48px 64px 32px", flexShrink: 0 }}>
				<span style={{ fontSize: 26, color: COR.terciario }}>top vendedores · {ranking.rotulo}</span>
				<div>
					<p style={{ fontSize: 26, color: COR.terciario, margin: "0 0 4px" }}>total vendido</p>
					<p style={{ ...NUMERO, fontSize: 28, fontWeight: 500, color: COR.texto, margin: 0 }}>
						{reaisCurto(ranking.totalVendido)}
					</p>
				</div>
			</div>

			{compacto ? (
				<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 24 }}>
					<div style={{ display: "flex", gap: 24, padding: "0 64px" }}>
						{top.slice(0, 3).map((v) => (
							<Destaque key={v.nome} v={v} />
						))}
					</div>
					<div style={{ display: "flex", gap: 48, padding: "0 40px" }}>
						{colunas.map((c, ci) => (
							<div key={ci} style={{ flex: 1, minWidth: 0 }}>
								{c.map((v, i) => (
									<Linha key={v.nome} v={v} ultima={i === c.length - 1} lateral={24} />
								))}
							</div>
						))}
					</div>
				</div>
			) : (
				<div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 16, padding: "0 64px" }}>
					{podio.map((v) => (
						<Podio key={v.nome} v={v} />
					))}
				</div>
			)}

			{!compacto && lista.length > 0 && (
				<div style={{ flexShrink: 0, borderTop: `1px solid ${COR.linha}` }}>
					{lista.map((v, i) => (
						<Linha key={v.nome} v={v} ultima={i === lista.length - 1} />
					))}
				</div>
			)}

			<TiraDeContexto
				itens={[
					{ rotulo: "pessoas com contrato fechado", valor: String(ranking.pessoasComContrato) },
					{ rotulo: "ticket médio", valor: reaisCurto(ranking.ticketMedio) },
					{
						rotulo: "maior contrato único",
						valor: ranking.maiorContrato
							? `${reaisCurto(ranking.maiorContrato.valor)} · ${ranking.maiorContrato.cliente}`
							: "—",
					},
				]}
			/>
		</div>
	);
}
