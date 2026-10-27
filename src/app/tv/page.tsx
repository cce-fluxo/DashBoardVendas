"use client";

// Painel de TV do escritório. Canvas fixo de 1920×1080 escalado para a largura
// da janela; as telas giram a cada 18 s. Desenho: Figma Make vMPbgU4OPKh16hHZZVJfXf.
//
// Os dados vêm de /api/tv a cada 5 min. Falha na busca MANTÉM o último dado
// bom — a TV não pode ficar em branco por uma queda de rede — e a idade do dado
// no rodapé mostra que ele envelheceu.

import { useCallback, useEffect, useState } from "react";
import { Pause, Play, RefreshCw } from "lucide-react";

import type { TelaTv, TvData } from "@/lib/tv";
import { EntregasTv } from "@/components/tv/EntregasTv";
import { FechadosTv } from "@/components/tv/FechadosTv";
import { FunilTv } from "@/components/tv/FunilTv";
import { MetasTv } from "@/components/tv/MetasTv";
import { RankingTv } from "@/components/tv/RankingTv";
import { COR, NUMERO } from "@/components/tv/formato";

const DURACAO_MS = 18_000;
const FADE_MS = 400;
const BUSCA_MS = 5 * 60_000;

type Resposta = TvData & { ultimaAtualizacao: string | null; dadoVelho: boolean };

const NOMES: Record<TelaTv, string> = {
	metas: "Metas",
	funil: "Funil comercial",
	"ranking-gestao": "Top vendedores",
	"ranking-historico": "Top vendedores · histórico",
	fechados: "Últimos fechados",
	entregas: "Últimas entregas",
};

function useEscala() {
	const [escala, setEscala] = useState(1);
	useEffect(() => {
		const medir = () => setEscala(window.innerWidth / 1920);
		medir();
		window.addEventListener("resize", medir);
		return () => window.removeEventListener("resize", medir);
	}, []);
	return escala;
}

function useDados() {
	const [dados, setDados] = useState<Resposta | null>(null);
	const [falhou, setFalhou] = useState(false);
	const buscar = useCallback(async () => {
		try {
			const r = await fetch("/api/tv", { cache: "no-store" });
			if (!r.ok) throw new Error(String(r.status));
			setDados((await r.json()) as Resposta);
			setFalhou(false);
		} catch {
			setFalhou(true);
		}
	}, []);
	useEffect(() => {
		const primeiro = setTimeout(buscar, 0);
		const id = setInterval(buscar, BUSCA_MS);
		return () => {
			clearTimeout(primeiro);
			clearInterval(id);
		};
	}, [buscar]);
	return { dados, falhou, buscar };
}

/**
 * Atualizar escondido: quase da cor do fundo, de propósito — quem sabe onde
 * fica usa, quem olha a TV não vê. Vai às fontes como o ↻ do /dashboard
 * (mesmo cooldown, mesma rota) e depois rebusca /api/tv.
 */
function Atualizar({ depois }: { depois: () => Promise<void> }) {
	const [rodando, setRodando] = useState(false);
	const clicar = async () => {
		if (rodando) return;
		setRodando(true);
		try {
			await fetch("/api/dashboard/atualizar", { method: "POST" });
			await depois();
		} finally {
			setRodando(false);
		}
	};
	return (
		<button
			onClick={clicar}
			aria-label="Atualizar dados"
			style={{ background: "none", border: "none", padding: 4, cursor: "pointer", display: "flex" }}
		>
			<RefreshCw
				size={16}
				color={rodando ? COR.terciario : "#EDEDED"}
				strokeWidth={1.5}
				style={rodando ? { animation: "girar 1s linear infinite" } : undefined}
			/>
			<style>{"@keyframes girar { to { transform: rotate(360deg) } }"}</style>
		</button>
	);
}

function Relogio() {
	const [agora, setAgora] = useState<Date | null>(null);
	// Só no cliente: a hora renderizada no servidor nunca bate com a do navegador.
	useEffect(() => {
		const tique = () => setAgora(new Date());
		const primeiro = setTimeout(tique, 0);
		const id = setInterval(tique, 1000);
		return () => {
			clearTimeout(primeiro);
			clearInterval(id);
		};
	}, []);
	if (!agora) return null;
	const p = (n: number) => String(n).padStart(2, "0");
	return (
		<span style={{ ...NUMERO, fontSize: 28, color: COR.secundario }}>
			{p(agora.getHours())}:{p(agora.getMinutes())}
			<span style={{ color: COR.terciario }}>:{p(agora.getSeconds())}</span>
		</span>
	);
}

function IdadeDoDado({ dados, falhou }: { dados: Resposta | null; falhou: boolean }) {
	if (!dados) return null;
	const hora = dados.ultimaAtualizacao
		? new Date(dados.ultimaAtualizacao).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
		: "—";
	const atrasado = dados.dadoVelho || falhou;
	return (
		<span style={{ fontSize: 18, color: atrasado ? COR.texto : COR.terciario }}>
			{atrasado ? "dados atrasados · " : "dados de "}
			<span style={NUMERO}>{hora}</span>
		</span>
	);
}

function Tela({ tela, dados }: { tela: TelaTv; dados: TvData }) {
	if (tela === "metas") return <MetasTv metas={dados.metas} />;
	if (tela === "funil") return <FunilTv funil={dados.funil} />;
	if (tela === "ranking-gestao") return <RankingTv ranking={dados.rankingGestao} />;
	if (tela === "ranking-historico") return <RankingTv ranking={dados.rankingHistorico} compacto />;
	if (tela === "entregas") return <EntregasTv dados={dados.entregas} />;
	return <FechadosTv dados={dados.fechados} />;
}

export default function PainelTv() {
	const escala = useEscala();
	const { dados, falhou, buscar } = useDados();
	const telas = dados?.telas ?? [];

	const [ativa, setAtiva] = useState(0);
	const [visivel, setVisivel] = useState(true);
	const [pausado, setPausado] = useState(false);
	const [rodada, setRodada] = useState(0);

	const irPara = useCallback((i: number) => {
		setVisivel(false);
		setTimeout(() => {
			setAtiva(i);
			setVisivel(true);
			setRodada((r) => r + 1);
		}, FADE_MS);
	}, []);

	useEffect(() => {
		if (pausado || telas.length < 2) return;
		const id = setTimeout(() => irPara((ativa + 1) % telas.length), DURACAO_MS);
		return () => clearTimeout(id);
	}, [ativa, rodada, pausado, telas.length, irPara]);

	// A lista de telas muda quando o dado muda (tela ganha ou perde dado).
	const indice = telas.length ? ativa % telas.length : 0;
	const tela = telas[indice];

	// Setas navegam como slide (e reiniciam os 18 s da tela); espaço pausa.
	useEffect(() => {
		const n = telas.length;
		const tecla = (e: KeyboardEvent) => {
			if (n < 2 && e.key !== " ") return;
			if (e.key === "ArrowRight") irPara((indice + 1) % n);
			else if (e.key === "ArrowLeft") irPara((indice - 1 + n) % n);
			else if (e.key === " ") {
				e.preventDefault();
				setPausado((p) => !p);
			}
		};
		window.addEventListener("keydown", tecla);
		return () => window.removeEventListener("keydown", tecla);
	}, [indice, telas.length, irPara]);

	return (
		<div style={{ width: "100vw", height: "56.25vw", overflow: "hidden", position: "relative" }}>
			<div
				style={{
					width: 1920,
					height: 1080,
					transform: `scale(${escala})`,
					transformOrigin: "top left",
					background: "#FFFFFF",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 80, flexShrink: 0, padding: "0 64px", borderBottom: `1px solid ${COR.linha}` }}>
					<span style={{ fontSize: 28, fontWeight: 500, color: COR.texto, letterSpacing: "-0.02em" }}>Fluxo</span>
					<span style={{ fontSize: 18, color: COR.terciario }}>{tela ? NOMES[tela] : ""}</span>
				</header>

				<main style={{ flex: 1, minHeight: 0, opacity: visivel ? 1 : 0, transition: `opacity ${FADE_MS}ms ease-in-out` }}>
					{dados && tela ? (
						<Tela tela={tela} dados={dados} />
					) : (
						<p style={{ fontSize: 28, color: COR.terciario, padding: 64, margin: 0 }}>
							{falhou ? "Não foi possível carregar os dados. Tentando de novo em 5 minutos." : dados ? "Sem dados para mostrar." : "Carregando…"}
						</p>
					)}
				</main>

				<footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 80, flexShrink: 0, padding: "0 64px", borderTop: `1px solid ${COR.linha}` }}>
					<div style={{ display: "flex", alignItems: "baseline", gap: 32 }}>
						<Relogio />
						<IdadeDoDado dados={dados} falhou={falhou} />
						<Atualizar depois={buscar} />
					</div>
					<div style={{ display: "flex", alignItems: "center", gap: 24 }}>
						<button
							onClick={() => setPausado((p) => !p)}
							aria-label={pausado ? "Retomar" : "Pausar"}
							style={{ background: "none", border: "none", padding: 4, cursor: "pointer", display: "flex", opacity: 0.5 }}
						>
							{pausado ? <Play size={22} color={COR.texto} strokeWidth={1.5} /> : <Pause size={22} color={COR.texto} strokeWidth={1.5} />}
						</button>
						<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
							{telas.map((t, i) => (
								<button
									key={t}
									onClick={() => i !== indice && irPara(i)}
									aria-label={NOMES[t]}
									style={{
										width: i === indice ? 32 : 10,
										height: 10,
										borderRadius: 5,
										border: "none",
										padding: 0,
										background: i === indice ? COR.marca : COR.linha,
										transition: "all 0.4s ease",
										cursor: i === indice ? "default" : "pointer",
									}}
								/>
							))}
						</div>
					</div>
				</footer>
			</div>
		</div>
	);
}
