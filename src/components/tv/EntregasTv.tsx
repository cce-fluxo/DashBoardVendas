// Últimas entregas. Desenho: LastDeliveriesScreen do Figma Make, no mesmo
// arranjo da tela de fechados. Sem "no prazo / com atraso": a planilha não tem
// essa informação confiável para todas as entregas, e a decisão foi não mostrar.

import { PackageCheck, Users } from "lucide-react";

import type { TvEntrega, TvEntregas } from "@/lib/tv";
import { TiraDeContexto } from "./Contexto";
import { Rosto } from "./Rosto";
import { COR, NUMERO, corDa, dataCurta, haQuanto } from "./formato";

const DIAS_DE_DESTAQUE = 30;

function Equipe({ n, tamanho, cor }: { n: number | null; tamanho: number; cor: string }) {
	if (n === null) return null;
	return (
		<span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: tamanho, color: cor }}>
			<Users size={tamanho} color={cor} strokeWidth={1.5} />
			{n === 1 ? "1 pessoa" : `${n} pessoas`} na equipe
		</span>
	);
}

/** A última entrega, em painel escuro: o laranja é dos contratos fechados. */
function Destaque({ e }: { e: TvEntrega }) {
	return (
		<div style={{ flex: 1, minHeight: 0, margin: "0 64px", borderRadius: 28, background: COR.texto, padding: "36px 56px", display: "flex", flexDirection: "column", justifyContent: "space-between", color: "#FFFFFF" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 16 }}>
				<span style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 22px", borderRadius: 999, background: "rgba(255,255,255,0.14)", fontSize: 26, fontWeight: 600 }}>
					<PackageCheck size={24} color="#FFFFFF" strokeWidth={2} />
					projeto entregue
				</span>
				<span style={{ fontSize: 26, color: "rgba(255,255,255,0.7)" }}>{haQuanto(e.data, e.diasAtras)}</span>
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
				<span style={{ alignSelf: "flex-start", padding: "4px 18px", borderRadius: 999, background: "#FFFFFF", color: corDa(e.coordenacao), fontSize: 30, fontWeight: 800, letterSpacing: "0.04em" }}>
					{e.coordenacao}
				</span>
				<span style={{ fontSize: 110, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
					{e.projeto}
				</span>
			</div>
			{/* Sem nomes na planilha, fica só o tamanho da equipe. */}
			{e.pessoas.length > 0 ? (
				<div style={{ display: "flex", alignItems: "center", gap: "16px 32px", flexWrap: "wrap" }}>
					{e.pessoas.map((p) => (
						<div key={p.nome} style={{ display: "flex", alignItems: "center", gap: 12 }}>
							<Rosto p={p} tamanho={64} anel="#FFFFFF" borda={3} />
							<span style={{ fontSize: 26, fontWeight: 600 }}>{p.nome}</span>
						</div>
					))}
				</div>
			) : (
				<Equipe n={e.equipe} tamanho={30} cor="rgba(255,255,255,0.85)" />
			)}
		</div>
	);
}

function Anterior({ e }: { e: TvEntrega }) {
	return (
		<div style={{ flex: 1, minWidth: 0, background: "#F6F6F6", borderRadius: 18, padding: "22px 28px", display: "flex", flexDirection: "column", gap: 10 }}>
			<span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.06em", color: corDa(e.coordenacao) }}>{e.coordenacao}</span>
			<span style={{ fontSize: 30, fontWeight: 600, color: COR.texto, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
				{e.projeto}
			</span>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
				{e.pessoas.length > 0 ? (
					<div style={{ display: "flex" }}>
						{e.pessoas.map((p, i) => (
							<div key={p.nome} style={{ marginLeft: i === 0 ? 0 : -12 }}>
								<Rosto p={p} tamanho={48} anel="#F6F6F6" borda={3} />
							</div>
						))}
					</div>
				) : (
					<Equipe n={e.equipe} tamanho={22} cor={COR.terciario} />
				)}
				<span style={{ fontSize: 22, color: COR.terciario }}>{dataCurta(e.data, true)}</span>
			</div>
		</div>
	);
}

export function EntregasTv({ dados }: { dados: TvEntregas }) {
	const [ultima, ...anteriores] = dados.entregas;
	const destaque = ultima && ultima.diasAtras <= DIAS_DE_DESTAQUE;

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "32px 64px 24px", flexShrink: 0 }}>
				<span style={{ fontSize: 26, color: COR.terciario }}>últimas entregas</span>
				<div>
					<span style={{ ...NUMERO, fontSize: 56, fontWeight: 700, letterSpacing: "-0.04em", color: COR.texto, lineHeight: 1 }}>
						{dados.totalGestao}
					</span>
					<span style={{ fontSize: 26, color: COR.terciario, display: "block", marginTop: 4 }}>
						entregas na gestão {dados.gestao}
					</span>
				</div>
			</div>

			{destaque ? (
				<Destaque e={ultima} />
			) : (
				<div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
					<span style={{ fontSize: 56, fontWeight: 600, color: COR.terciario }}>
						{`última entrega há ${ultima.diasAtras} dias`}
					</span>
				</div>
			)}

			{/* Sem destaque, a última entra na fila: é ela que dá contexto à frase. */}
			<div style={{ display: "flex", gap: 24, padding: "24px 64px", flexShrink: 0 }}>
				{(destaque ? anteriores : dados.entregas.slice(0, 3)).map((e) => (
					<Anterior key={`${e.coordenacao}-${e.projeto}`} e={e} />
				))}
			</div>

			<TiraDeContexto
				itens={[
					{ rotulo: `entregas no ${dados.ciclo}`, valor: String(dados.noCiclo) },
					{ rotulo: `gestão ${dados.gestaoAnterior} inteira`, valor: String(dados.totalAnterior) },
					{ rotulo: "projetos em execução", valor: String(dados.emExecucao) },
				]}
			/>
		</div>
	);
}
