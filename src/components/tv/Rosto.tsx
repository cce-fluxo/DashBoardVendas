import type { TvPessoa } from "@/lib/tv";
import { COR } from "./formato";

/** Foto da pessoa (pessoa.foto_url) ou, sem ela, as iniciais. */
export function Rosto({ p, tamanho, anel, borda = 6 }: { p: TvPessoa; tamanho: number; anel: string; borda?: number }) {
	return (
		<div style={{ width: tamanho, height: tamanho, borderRadius: "50%", border: `${borda}px solid ${anel}`, padding: Math.round(borda * 0.66), background: "#FFFFFF", flexShrink: 0 }}>
			{p.foto ? (
				// eslint-disable-next-line @next/next/no-img-element -- URL externa arbitrária (pessoa.foto_url); next/image exigiria cadastrar cada host
				<img src={p.foto} alt={p.nome} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block" }} />
			) : (
				<div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#F1F1F1", display: "flex", alignItems: "center", justifyContent: "center" }}>
					<span style={{ fontSize: Math.round(tamanho * 0.3), fontWeight: 600, color: COR.secundario }}>{p.iniciais}</span>
				</div>
			)}
		</div>
	);
}
