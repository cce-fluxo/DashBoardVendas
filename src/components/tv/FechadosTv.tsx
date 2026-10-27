import { Sparkles, TrendingUp } from "lucide-react";

import type { TvFechado, TvFechados } from "@/lib/tv";
import { TiraDeContexto } from "./Contexto";
import { Rosto } from "./Rosto";
import { COR, NUMERO, corDa, dataCurta, haQuanto, reaisCurto } from "./formato";

// Destaque grande só para fechamento recente; depois disso a tela diz há
// quanto tempo não fecha nada, em vez de celebrar um contrato de dois meses.
const DIAS_DE_DESTAQUE = 30;

const BRANCO_SUAVE = "rgba(255,255,255,0.85)";

/** O último contrato, em painel laranja: é a tela que se vê do outro lado da sala. */
function Destaque({ f }: { f: TvFechado }) {
	return (
		<div style={{ flex: 1, minHeight: 0, margin: "0 64px", borderRadius: 28, background: COR.marca, padding: "32px 56px 36px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 16, color: "#FFFFFF" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
				<span style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 22px", borderRadius: 999, background: "rgba(255,255,255,0.2)", fontSize: 26, fontWeight: 600 }}>
					<Sparkles size={24} color="#FFFFFF" strokeWidth={2} />
					contrato fechado
				</span>
				<span style={{ fontSize: 26, color: BRANCO_SUAVE }}>{haQuanto(f.data, f.diasAtras)}</span>
			</div>

			<div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 48, minWidth: 0 }}>
				<div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
					<span style={{ fontSize: 88, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
						{f.projeto}
					</span>
					<div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
						{/* Pílula branca: amarelo e rosa direto no laranja não se leem de longe. */}
						<span style={{ padding: "4px 16px", borderRadius: 999, background: "#FFFFFF", color: corDa(f.coordenacao), fontSize: 28, fontWeight: 800, letterSpacing: "0.04em", flexShrink: 0 }}>
							{f.coordenacao}
						</span>
						{f.cliente !== f.projeto && (
							<span style={{ fontSize: 30, color: BRANCO_SUAVE, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
								{f.cliente}
							</span>
						)}
					</div>
				</div>
				<span style={{ ...NUMERO, fontSize: 150, fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 0.9, flexShrink: 0 }}>
					{reaisCurto(f.valor)}
				</span>
			</div>

			{f.responsaveis.length > 0 && (
				<div style={{ display: "flex", alignItems: "center", gap: 36, flexWrap: "wrap" }}>
					{f.responsaveis.map((p) => (
						<div key={p.nome} style={{ display: "flex", alignItems: "center", gap: 14 }}>
							<Rosto p={p} tamanho={72} anel="#FFFFFF" borda={4} />
							<span style={{ fontSize: 28, fontWeight: 600 }}>{p.nome}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function Anterior({ f }: { f: TvFechado }) {
	return (
		<div style={{ flex: 1, minWidth: 0, background: "#F6F6F6", borderRadius: 18, padding: "22px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
			<span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.06em", color: corDa(f.coordenacao) }}>{f.coordenacao}</span>
			<span style={{ fontSize: 28, fontWeight: 600, color: COR.texto, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
				{f.projeto}
			</span>
			<span style={{ ...NUMERO, fontSize: 44, fontWeight: 700, letterSpacing: "-0.03em", color: COR.texto, lineHeight: 1 }}>
				{reaisCurto(f.valor)}
			</span>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
				<div style={{ display: "flex" }}>
					{f.responsaveis.map((p, i) => (
						<div key={p.nome} style={{ marginLeft: i === 0 ? 0 : -12 }}>
							<Rosto p={p} tamanho={48} anel="#F6F6F6" borda={3} />
						</div>
					))}
				</div>
				<span style={{ fontSize: 22, color: COR.terciario }}>{dataCurta(f.data, f.dataExata)}</span>
			</div>
		</div>
	);
}

export function FechadosTv({ dados }: { dados: TvFechados }) {
	const [ultimo, ...anteriores] = dados.fechados;
	// Sem data de assinatura só se sabe o mês (diasAtras null): o destaque fica,
	// com "em out. de 2026" no lugar de "há N dias".
	const dias = ultimo?.diasAtras ?? null;
	const destaque = ultimo && (dias === null || dias <= DIAS_DE_DESTAQUE);
	const delta =
		dados.anteriorMesmoPonto === null ? null : dados.totalGestao - dados.anteriorMesmoPonto;

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "32px 64px 24px", flexShrink: 0 }}>
				<span style={{ fontSize: 26, color: COR.terciario }}>últimos fechados</span>
				<div style={{ display: "flex", alignItems: "stretch", gap: 32 }}>
					<div>
						<div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
							<span style={{ ...NUMERO, fontSize: 56, fontWeight: 700, letterSpacing: "-0.04em", color: COR.texto, lineHeight: 1 }}>
								{dados.totalGestao}
							</span>
							{delta !== null && delta > 0 && (
								<span style={{ ...NUMERO, display: "flex", alignItems: "center", gap: 4, fontSize: 24, fontWeight: 500, color: "#2D7A3A" }}>
									<TrendingUp size={20} color="#2D7A3A" strokeWidth={1.5} />+{delta}
								</span>
							)}
						</div>
						<span style={{ fontSize: 26, color: COR.terciario, display: "block", marginTop: 4 }}>
							vendas na gestão {dados.gestao}
						</span>
					</div>
					{dados.anteriorMesmoPonto !== null && (
						<>
							<div style={{ width: 1, background: COR.linha }} />
							<div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
								<span style={{ ...NUMERO, fontSize: 32, fontWeight: 500, letterSpacing: "-0.02em", color: COR.terciario, lineHeight: 1 }}>
									{dados.anteriorMesmoPonto}
								</span>
								<span style={{ fontSize: 26, color: COR.terciario, display: "block", marginTop: 4 }}>
									gestão {dados.gestaoAnterior} no mesmo ponto
								</span>
							</div>
						</>
					)}
				</div>
			</div>

			{destaque ? (
				<Destaque f={ultimo} />
			) : (
				<div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
					<span style={{ fontSize: 56, fontWeight: 600, color: COR.terciario }}>
						{ultimo ? `último fechamento há ${dias} dias` : "nenhum fechamento na gestão"}
					</span>
				</div>
			)}

			{anteriores.length > 0 && (
				<div style={{ display: "flex", gap: 24, padding: "24px 64px", flexShrink: 0 }}>
					{anteriores.map((f) => (
						<Anterior key={`${f.projeto}-${f.data}`} f={f} />
					))}
				</div>
			)}

			<TiraDeContexto
				itens={[
					{ rotulo: `valor fechado no ${dados.ciclo}`, valor: reaisCurto(dados.valorCiclo) },
					{
						rotulo: "média por semana na gestão",
						valor: `${dados.mediaPorSemana.toFixed(1).replace(".", ",")}/sem`,
					},
					{ rotulo: "dias desde o último fechamento", valor: dias === null ? "—" : String(dias) },
				]}
			/>
		</div>
	);
}
