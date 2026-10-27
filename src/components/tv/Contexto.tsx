import { Fragment } from "react";
import { ChessPawn, type LucideIcon } from "lucide-react";

import { COR, NUMERO } from "./formato";

// Ícone de cada ciclo pelo nome. Gambito: o lance que sacrifica um peão.
const ICONES_DE_CICLO: Record<string, LucideIcon> = { "Ciclo Gambito": ChessPawn };

/** Nome do ciclo com o ícone dele, quando tem. */
export function NomeDoCiclo({ rotulo, tamanho }: { rotulo: string; tamanho: number }) {
	const Icone = ICONES_DE_CICLO[rotulo];
	return (
		<span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(tamanho * 0.35) }}>
			{Icone && <Icone size={Math.round(tamanho * 1.1)} color={COR.marca} strokeWidth={1.75} />}
			{rotulo}
		</span>
	);
}

/** Tira de contexto: três métricas, mesma posição e altura em toda tela. */
export function TiraDeContexto({ itens }: { itens: { rotulo: string; valor: string }[] }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 64,
				padding: "24px 64px",
				borderTop: `1px solid ${COR.linha}`,
				flexShrink: 0,
			}}
		>
			{itens.map((it, i) => (
				<Fragment key={it.rotulo}>
					{i > 0 && <div style={{ width: 1, height: 32, background: COR.linha }} />}
					<div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
						<span style={{ fontSize: 26, color: COR.terciario }}>{it.rotulo}</span>
						<span style={{ ...NUMERO, fontSize: 28, fontWeight: 500, color: COR.texto }}>
							{it.valor}
						</span>
					</div>
				</Fragment>
			))}
		</div>
	);
}
