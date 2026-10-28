// Tela de metas: o mês em dois números grandes (vendas e faturamento), cada um
// com a marca de onde deveria estar hoje e se está no ritmo; embaixo, os meses
// do ciclo em cartões. Partiu do GoalsScreen do Figma Make.
//
// Diferenças do Figma, de propósito:
// - sem o gráfico de 12 meses: com um mês realizado e o previsto caindo a zero
//   (só conta contrato assinado), ele não dizia nada;
// - mês sem meta mostra "sem meta": "?????" na planilha não é meta zero;
// - sem meta de faturamento, o alvo é o previsto da planilha;
// - letras maiores e cinzas mais escuros: a TV da sede é antiga e lava contraste.

import { FileText, TrendingUp } from "lucide-react";

import type { TvMetaMes, TvMetas } from "@/lib/tv";
import { NomeDoCiclo, TiraDeContexto } from "./Contexto";
import { COR, NUMERO, reaisCurto } from "./formato";

const VERDE = "#2D7A3A";
const VERMELHO = "#C53030";
/** Abaixo da marca de hoje por menos que isso ainda é "no ritmo": 1 pp não é atraso. */
const FOLGA = 0.05;

const fracao = (v: number, alvo: number | null) => (alvo ? v / alvo : 0);

function Barra({ cheio, pendente = 0, cor, hoje, altura }: { cheio: number; pendente?: number; cor: string; hoje?: number; altura: number }) {
	const c = Math.min(cheio, 1) * 100;
	const p = Math.min(pendente, 1 - Math.min(cheio, 1)) * 100;
	return (
		<div style={{ position: "relative", height: altura }}>
			<div style={{ position: "absolute", inset: 0, borderRadius: altura / 2, background: "#EBEBEB", overflow: "hidden" }}>
				<div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${c}%`, background: cor }} />
				{p > 0 && <div style={{ position: "absolute", top: 0, height: "100%", left: `${c}%`, width: `${p}%`, background: "#C8C8C8" }} />}
			</div>
			{hoje !== undefined && (
				<div style={{ position: "absolute", left: `${hoje * 100}%`, top: -12, bottom: -12, width: 4, borderRadius: 2, background: COR.texto, transform: "translateX(-2px)" }}>
					<span style={{ position: "absolute", bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", fontSize: 20, fontWeight: 600, color: COR.texto, whiteSpace: "nowrap" }}>
						hoje
					</span>
				</div>
			)}
		</div>
	);
}

/**
 * Faturamento chega em blocos (nota emitida na data do contrato), não por dia:
 * com `pendente` (previsto ainda não faturado), o que conta é se o previsto
 * cobre a meta, não a marca de hoje.
 */
function Ritmo({ valor, alvo, hoje, pendente }: { valor: number; alvo: number; hoje: number; pendente?: number }) {
	const f = valor / alvo;
	const [cor, texto, resto] =
		f >= 1
			? [VERDE, "meta batida!", `+${reaisCurto(valor - alvo)} acima`]
			: pendente !== undefined
				? valor + pendente >= alvo
					? [VERDE, "previsto cobre a meta", `falta faturar ${reaisCurto(alvo - valor)}`]
					: [VERMELHO, "previsto não cobre a meta", `faltam ${reaisCurto(alvo - valor - pendente)} sem contrato`]
				: f >= hoje - FOLGA
				? [VERDE, "no ritmo", `falta ${reaisCurto(alvo - valor)}`]
				: [VERMELHO, "atrás do ritmo", `falta ${reaisCurto(alvo - valor)}`];
	return (
		<p style={{ ...NUMERO, display: "flex", alignItems: "center", gap: 14, fontSize: 32, margin: 0 }}>
			<span style={{ width: 18, height: 18, borderRadius: 9, background: cor }} />
			<span style={{ fontWeight: 700, color: cor }}>{texto}</span>
			<span style={{ color: COR.secundario }}>· {resto}</span>
		</p>
	);
}

function Coluna({ rotulo, Icone, valor, alvo, pendente, cor, hoje }: { rotulo: string; Icone: typeof TrendingUp; valor: number; alvo: number | null; pendente?: number; cor: string; hoje: number }) {
	return (
		<div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 28, padding: "36px 64px 0" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
				<Icone size={30} color={COR.secundario} strokeWidth={1.75} />
				<p style={{ fontSize: 32, fontWeight: 600, color: COR.texto, margin: 0 }}>{rotulo}</p>
			</div>
			<div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
				<p style={{ ...NUMERO, fontSize: 150, fontWeight: 700, letterSpacing: "-0.04em", color: cor, margin: 0, lineHeight: 0.9 }}>{reaisCurto(valor)}</p>
				<p style={{ ...NUMERO, fontSize: 44, fontWeight: 500, color: COR.secundario, margin: 0 }}>{alvo ? `/ ${reaisCurto(alvo)}` : "sem meta"}</p>
			</div>
			{alvo ? (
				<>
					<div style={{ marginTop: 20 }}>
						{/* Faturamento sem marca de hoje: chega em blocos, ver Ritmo. */}
						<Barra cheio={fracao(valor, alvo)} pendente={fracao(pendente ?? 0, alvo)} cor={cor} hoje={pendente === undefined ? hoje : undefined} altura={28} />
					</div>
					<Ritmo valor={valor} alvo={alvo} hoje={hoje} pendente={pendente} />
				</>
			) : null}
			{!!pendente && <p style={{ ...NUMERO, fontSize: 26, color: COR.secundario, margin: "-12px 0 0" }}>+{reaisCurto(pendente)} previstos a faturar</p>}
		</div>
	);
}

function Cartao({ mes, atual, futuro }: { mes: TvMetaMes; atual: boolean; futuro: boolean }) {
	return (
		<div style={{ flex: 1, minWidth: 0, background: "#F4F4F4", borderRadius: 18, padding: "18px 26px", display: "flex", flexDirection: "column", gap: 10, boxShadow: atual ? `inset 0 0 0 3px ${COR.marca}` : undefined }}>
			<span style={{ fontSize: 24, fontWeight: atual ? 700 : 500, color: atual ? COR.texto : COR.secundario }}>{mes.nome}</span>
			{futuro ? (
				<span style={{ ...NUMERO, fontSize: 30, fontWeight: 600, color: COR.secundario }}>{mes.metaVendas ? `meta ${reaisCurto(mes.metaVendas)}` : "sem meta"}</span>
			) : (
				<span style={{ ...NUMERO, fontSize: 36, fontWeight: 700, color: COR.texto }}>
					{reaisCurto(mes.vendido)}
					<span style={{ fontSize: 24, fontWeight: 500, color: COR.secundario }}>{mes.metaVendas ? ` / ${reaisCurto(mes.metaVendas)}` : " · sem meta"}</span>
				</span>
			)}
			<Barra cheio={futuro ? 0 : fracao(mes.vendido, mes.metaVendas)} cor={atual ? COR.marca : COR.texto} altura={10} />
		</div>
	);
}

function CartaoDoCiclo({ m }: { m: TvMetas }) {
	return (
		<div style={{ flex: 1, minWidth: 0, background: COR.texto, color: "#FFFFFF", borderRadius: 18, padding: "18px 26px", display: "flex", flexDirection: "column", gap: 10 }}>
			<span style={{ fontSize: 24, fontWeight: 500, color: "rgba(255,255,255,0.75)" }}>vendas no ciclo</span>
			<span style={{ ...NUMERO, fontSize: 36, fontWeight: 700 }}>
				{reaisCurto(m.vendidoCiclo)}
				<span style={{ fontSize: 24, fontWeight: 500, color: "rgba(255,255,255,0.75)" }}>{m.metaVendasCiclo !== null ? ` / ${reaisCurto(m.metaVendasCiclo)}` : " · sem meta"}</span>
			</span>
			<div style={{ height: 10, borderRadius: 5, background: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
				<div style={{ height: "100%", width: `${Math.min(fracao(m.vendidoCiclo, m.metaVendasCiclo), 1) * 100}%`, background: COR.marca }} />
			</div>
		</div>
	);
}

export function MetasTv({ metas: m }: { metas: TvMetas }) {
	const mes = m.meses[m.mesAtual];
	const pendente = Math.max(0, (mes.previsto ?? 0) - (mes.faturado ?? 0));
	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "36px 64px 0" }}>
				<span style={{ fontSize: 32, fontWeight: 600, color: COR.texto }}>
					<NomeDoCiclo rotulo={m.ciclo} tamanho={32} />
				</span>
				<span style={{ ...NUMERO, fontSize: 26, color: COR.secundario }}>
					semana {m.semana} de {m.semanas} · faltam {m.faltamDias} dias
				</span>
			</div>

			<div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", padding: "24px 0" }}>
				<Coluna rotulo={`vendas de ${mes.nome}`} Icone={TrendingUp} valor={mes.vendido} alvo={mes.metaVendas} cor={COR.marca} hoje={m.hojeNoMes} />
				<div style={{ width: 2, background: COR.linha, margin: "24px 0" }} />
				<Coluna
					rotulo={`faturamento de ${mes.nome}`}
					Icone={FileText}
					valor={mes.faturado ?? 0}
					alvo={mes.metaFaturamento ?? mes.previsto}
					pendente={pendente}
					cor={COR.texto}
					hoje={m.hojeNoMes}
				/>
			</div>

			<div style={{ display: "flex", gap: 20, padding: "0 64px 28px" }}>
				{m.meses.map((x, i) => (
					<Cartao key={x.abrev} mes={x} atual={i === m.mesAtual} futuro={i > m.mesAtual} />
				))}
				<CartaoDoCiclo m={m} />
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
