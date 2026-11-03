import {
	ChevronDown,
	CircleCheck,
	FileText,
	Filter,
	TrendingDown,
	TrendingUp,
	Users,
} from "lucide-react";

import type { TvAlocado, TvFunil } from "@/lib/tv";
import { NomeDoCiclo, TiraDeContexto } from "./Contexto";
import { Rosto } from "./Rosto";
import { COR, NUMERO, pct, reaisCurto } from "./formato";

const ICONES = [Users, Filter, FileText, CircleCheck];

// Geometria do Figma: trapézios empilhados, do 100% ao 30% de largura.
const SVG_W = 1792;
const TRAP_MAX_W = 920;
const TRAP_MIN_PCT = 0.3;
const CENTRO_X = 620;
const VAO = 16;
const TAXA_X = 1140;
const SVG_H = 520;
// À direita das taxas (que terminam perto de x=1270), até a margem de 64.
const ALOCADOS_X = 1360;
const ALOCADOS_W = 1920 - 64 - ALOCADOS_X;

/** Quem está em mais cards em aberto: preenche o vazio à direita do funil. */
function Alocados({ alocados }: { alocados: TvAlocado[] }) {
	const altura = (SVG_H - 48) / Math.max(alocados.length, 1);
	return (
		<div style={{ position: "absolute", left: ALOCADOS_X, top: 0, width: ALOCADOS_W, height: SVG_H, display: "flex", flexDirection: "column" }}>
			<p style={{ fontSize: 22, color: COR.terciario, margin: 0, height: 48 }}>mais cards em aberto</p>
			{alocados.map((p, i) => (
				<div key={p.nome} style={{ height: altura, display: "flex", alignItems: "center", gap: 20, borderTop: i > 0 ? `1px solid ${COR.linha}` : undefined }}>
					<span style={{ ...NUMERO, width: 32, fontSize: 24, fontWeight: 700, color: i === 0 ? COR.marca : COR.terciario }}>{i + 1}º</span>
					<Rosto p={p} tamanho={56} anel={i === 0 ? COR.marca : COR.linha} borda={3} />
					<span style={{ flex: 1, minWidth: 0, fontSize: 28, fontWeight: i === 0 ? 600 : 500, color: COR.texto, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
						{p.nome}
					</span>
					<span style={{ ...NUMERO, fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em", color: i === 0 ? COR.marca : COR.texto }}>{p.cards}</span>
				</div>
			))}
		</div>
	);
}

export function FunilTv({ funil }: { funil: TvFunil }) {
	const n = funil.etapas.length;
	const bordas = Array.from({ length: n + 1 }, (_, i) => TRAP_MAX_W * (1 - (i / n) * (1 - TRAP_MIN_PCT)));
	const alturaTrap = (SVG_H - (n - 1) * VAO) / n;

	// A pior passagem leva o laranja: é o dado que pede ação.
	const validas = funil.taxas.filter((t): t is number => t !== null);
	const pior = validas.length ? Math.min(...validas) : null;
	const piorIdx = pior === null ? -1 : funil.taxas.indexOf(pior);

	const vs = funil.vsCicloAnterior;

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<div style={{ display: "flex", justifyContent: "space-between", padding: "48px 64px 40px", flexShrink: 0 }}>
				<div>
					<p style={{ fontSize: 22, color: COR.terciario, margin: "0 0 12px" }}>
						funil comercial · <NomeDoCiclo rotulo={funil.ciclo} tamanho={22} />
					</p>
					<div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
						<p style={{ ...NUMERO, fontSize: 96, fontWeight: 700, letterSpacing: "-0.04em", color: COR.texto, margin: 0, lineHeight: 1 }}>
							{funil.conversaoTotal === null ? "—" : pct(funil.conversaoTotal, 1)}
						</p>
						<p style={{ fontSize: 28, color: COR.terciario, margin: 0 }}>lead → fechado</p>
					</div>
				</div>
				<div>
					<p style={{ fontSize: 22, color: COR.terciario, margin: "0 0 12px" }}>
						vs ciclo anterior, mesma idade
					</p>
					<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
						{vs !== null &&
							(vs >= 0 ? (
								<TrendingUp size={40} color={COR.texto} strokeWidth={1.5} />
							) : (
								<TrendingDown size={40} color={COR.texto} strokeWidth={1.5} />
							))}
						<p style={{ ...NUMERO, fontSize: 48, fontWeight: 700, letterSpacing: "-0.03em", color: COR.texto, margin: 0, lineHeight: 1 }}>
							{vs === null ? "—" : `${vs >= 0 ? "+" : ""}${vs.toFixed(1).replace(".", ",")} pp`}
						</p>
					</div>
				</div>
			</div>

			<div style={{ flex: 1, minHeight: 0, position: "relative", padding: "0 64px" }}>
				<svg width={SVG_W} height={SVG_H} style={{ position: "absolute", top: 0, left: 64, overflow: "visible" }}>
					{funil.etapas.map((_, i) => {
						const y = i * (alturaTrap + VAO);
						const [topo, base] = [bordas[i], bordas[i + 1]];
						const pontos = [
							[CENTRO_X - topo / 2, y],
							[CENTRO_X + topo / 2, y],
							[CENTRO_X + base / 2, y + alturaTrap],
							[CENTRO_X - base / 2, y + alturaTrap],
						]
							.map(([x, yy]) => `${x},${yy}`)
							.join(" ");
						return <polygon key={i} points={pontos} fill={i === piorIdx ? COR.marca : COR.texto} />;
					})}
				</svg>

				{funil.etapas.map((etapa, i) => {
					const largura = (bordas[i] + bordas[i + 1]) / 2;
					const Icone = ICONES[i] ?? Users;
					return (
						<div
							key={etapa.nome}
							style={{
								position: "absolute",
								left: 64 + CENTRO_X - largura / 2,
								top: i * (alturaTrap + VAO),
								height: alturaTrap,
								width: largura,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								gap: 16,
								color: "#FFFFFF",
							}}
						>
							<Icone size={28} color="#FFFFFF" strokeWidth={1.5} />
							<span style={{ fontSize: 28, whiteSpace: "nowrap" }}>{etapa.nome}</span>
							<span style={{ ...NUMERO, fontSize: 32, fontWeight: 500 }}>{etapa.quantidade}</span>
						</div>
					);
				})}

				{funil.taxas.map((taxa, i) => {
					const ehPior = i === piorIdx;
					const cor = ehPior ? "#C0392B" : COR.terciario;
					return (
						<div
							key={i}
							style={{
								position: "absolute",
								left: 64 + TAXA_X,
								top: i * (alturaTrap + VAO) + alturaTrap,
								height: VAO,
								display: "flex",
								alignItems: "center",
								gap: 6,
							}}
						>
							{ehPior && <ChevronDown size={18} color={cor} strokeWidth={1.5} />}
							<span style={{ ...NUMERO, fontSize: 26, fontWeight: ehPior ? 500 : 400, color: cor }}>
								{taxa === null ? "—" : pct(taxa)}
							</span>
						</div>
					);
				})}

				{funil.alocados.length > 0 && <Alocados alocados={funil.alocados} />}
			</div>

			<TiraDeContexto
				itens={[
					{ rotulo: "ticket médio do ciclo", valor: reaisCurto(funil.ticketMedio) },
					{ rotulo: "ciclo médio de venda", valor: funil.etapas[3].quantidade > 0 ? `${Math.round(funil.diasAteVenda)} dias` : "—" },
					{ rotulo: "propostas em aberto", valor: String(funil.propostasAbertas) },
				]}
			/>
		</div>
	);
}
