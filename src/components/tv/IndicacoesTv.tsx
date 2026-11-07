import type { TvIndicacoes } from "@/lib/tv";
import { Rosto } from "./Rosto";
import { COR, NUMERO, corDa } from "./formato";

// Cores do pódio, as mesmas do RankingTv.
const MEDALHA = [COR.marca, "#9AA0A6", "#B98455"];
const LINHAS = 10;

/** Contador da campanha à esquerda, ranking de quem indicou à direita. */
export function IndicacoesTv({ dados }: { dados: TvIndicacoes }) {
	const lider = dados.ranking[0]?.indicacoes ?? 1;
	// Empate divide a posição, como no ranking de vendas (o ranking já vem ordenado).
	const linhas = dados.ranking.slice(0, LINHAS).map((p) => ({
		...p,
		posicao: dados.ranking.findIndex((q) => q.indicacoes === p.indicacoes) + 1,
	}));

	return (
		<div style={{ display: "flex", height: "100%" }}>
			<div style={{ width: 640, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 64px", borderRight: `1px solid ${COR.linha}` }}>
				<span style={{ fontSize: 28, color: COR.terciario }}>campanha de indicações</span>
				<span style={{ ...NUMERO, fontSize: 280, fontWeight: 700, letterSpacing: "-0.06em", color: COR.marca, lineHeight: 1, margin: "16px 0" }}>
					{dados.total}
				</span>
				<span style={{ fontSize: 32, color: COR.texto }}>{dados.total === 1 ? "indicação" : "indicações"} até agora</span>
				<span style={{ fontSize: 24, color: COR.terciario, marginTop: 12 }}>
					de <span style={NUMERO}>{dados.ranking.length}</span> {dados.ranking.length === 1 ? "pessoa" : "pessoas"}
				</span>
			</div>

			<div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8, padding: "32px 64px" }}>
				<span style={{ fontSize: 26, color: COR.terciario, marginBottom: 16 }}>quem mais indicou</span>
				{linhas.length === 0 && (
					<span style={{ fontSize: 36, color: COR.texto }}>Ninguém indicou ainda. Seja o primeiro!</span>
				)}
				{linhas.map((p) => {
					const medalha = MEDALHA[p.posicao - 1];
					return (
						<div key={p.nome} style={{ display: "flex", alignItems: "center", gap: 24, height: 68 }}>
							<span style={{ ...NUMERO, fontSize: 30, fontWeight: 700, color: medalha ?? COR.terciario, width: 52 }}>{p.posicao}º</span>
							<Rosto p={p} tamanho={60} anel={medalha ?? COR.linha} borda={3} />
							<div style={{ width: 380, minWidth: 0, display: "flex", alignItems: "center", gap: 14 }}>
								<span style={{ fontSize: 28, fontWeight: p.posicao === 1 ? 600 : 500, color: COR.texto, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
									{p.nome}
								</span>
								{p.coordenacao && (
									<span style={{ fontSize: 16, fontWeight: 600, color: corDa(p.coordenacao), flexShrink: 0 }}>{p.coordenacao}</span>
								)}
							</div>
							<div style={{ flex: 1, height: 14, borderRadius: 7, background: "#F3F3F3" }}>
								<div style={{ width: `${(p.indicacoes / lider) * 100}%`, height: "100%", borderRadius: 7, background: p.posicao === 1 ? COR.marca : "#CFCFCF" }} />
							</div>
							<span style={{ ...NUMERO, fontSize: 36, fontWeight: 700, color: COR.texto, width: 72, textAlign: "right" }}>{p.indicacoes}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
