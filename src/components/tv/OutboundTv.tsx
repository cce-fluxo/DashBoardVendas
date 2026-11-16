import { MARCOS, type Outbound, type OutboundTime } from "@/lib/outbound";
import { Rosto } from "./Rosto";
import { COR, NUMERO } from "./formato";

// Cor fixa por time (não por posição): quem olha a TV todo dia associa a cor ao
// time, e trocar quando a liderança vira confundiria o placar.
const COR_TIME = [COR.marca, "#2B2B2B"];

const primeiroNome = (nome: string) => nome.split(/\s+/)[0];

function Time({ t, cor, lado, lidera }: { t: OutboundTime; cor: string; lado: "esq" | "dir"; lidera: boolean }) {
	return (
		<div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: lado === "esq" ? "flex-start" : "flex-end", padding: "40px 64px 0" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 16, flexDirection: lado === "esq" ? "row" : "row-reverse" }}>
				<span style={{ width: 18, height: 18, borderRadius: 9, background: cor }} />
				<span style={{ fontSize: 40, fontWeight: 600, color: COR.texto }}>{t.nome}</span>
				{lidera && (
					<span style={{ fontSize: 20, fontWeight: 600, color: "#FFFFFF", background: cor, borderRadius: 16, padding: "4px 14px" }}>na frente</span>
				)}
			</div>
			<span style={{ ...NUMERO, fontSize: 210, fontWeight: 700, letterSpacing: "-0.05em", lineHeight: 1, color: cor, margin: "8px 0 0" }}>{t.pontos}</span>
			<span style={{ fontSize: 26, color: COR.terciario }}>pontos</span>
			<div style={{ display: "flex", gap: 28, marginTop: 36, flexDirection: lado === "esq" ? "row" : "row-reverse" }}>
				{t.membros.map((m) => (
					<div key={m.nome} style={{ width: 120, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
						<Rosto p={m} tamanho={104} anel={m.pontos > 0 ? cor : COR.linha} borda={4} />
						<span style={{ fontSize: 22, fontWeight: 500, color: COR.texto, whiteSpace: "nowrap" }}>{primeiroNome(m.nome)}</span>
						<span style={{ ...NUMERO, fontSize: 26, fontWeight: 700, color: m.pontos > 0 ? COR.texto : COR.terciario }}>{m.pontos}</span>
					</div>
				))}
			</div>
		</div>
	);
}

/** Placar dos dois times em cima; embaixo, cada marco como cabo de guerra. */
export function OutboundTv({ dados }: { dados: Outbound }) {
	const [a, b] = dados.times;
	const lider = a.pontos === b.pontos ? -1 : a.pontos > b.pontos ? 0 : 1;

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<div style={{ display: "flex", alignItems: "stretch", flex: 1, minHeight: 0 }}>
				<Time t={a} cor={COR_TIME[0]} lado="esq" lidera={lider === 0} />
				<div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
					<div style={{ flex: 1, width: 1, background: COR.linha }} />
					<span style={{ fontSize: 44, fontWeight: 700, color: COR.terciario }}>VS</span>
					<div style={{ flex: 1, width: 1, background: COR.linha }} />
				</div>
				<Time t={b} cor={COR_TIME[1]} lado="dir" lidera={lider === 1} />
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "28px 64px 36px", borderTop: `1px solid ${COR.linha}` }}>
				{MARCOS.map((m) => {
					const va = a.marcos[m.chave];
					const vb = b.marcos[m.chave];
					const total = va + vb;
					return (
						<div key={m.chave} style={{ display: "flex", alignItems: "center", gap: 24, height: 34 }}>
							<span style={{ ...NUMERO, width: 80, fontSize: 30, fontWeight: 700, color: COR.texto, textAlign: "right" }}>{va}</span>
							<div style={{ flex: 1, height: 14, borderRadius: 7, display: "flex", overflow: "hidden", background: "#F3F3F3" }}>
								{total > 0 && (
									<>
										<div style={{ width: `${(va / total) * 100}%`, background: COR_TIME[0] }} />
										<div style={{ width: `${(vb / total) * 100}%`, background: COR_TIME[1] }} />
									</>
								)}
							</div>
							<span style={{ ...NUMERO, width: 80, fontSize: 30, fontWeight: 700, color: COR.texto }}>{vb}</span>
							<span style={{ width: 360, fontSize: 24, color: COR.secundario }}>
								{m.rotulo} <span style={{ ...NUMERO, color: COR.marca, fontWeight: 600 }}>+{m.pontos}</span>
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
