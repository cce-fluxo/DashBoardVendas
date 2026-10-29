"use client";

// Painel de TV do escritório. Canvas fixo de 1920×1080 escalado para a largura
// da janela; as telas giram a cada 18 s. Desenho: Figma Make vMPbgU4OPKh16hHZZVJfXf.
//
// Os dados vêm de /api/tv a cada 5 min. Falha na busca MANTÉM o último dado
// bom — a TV não pode ficar em branco por uma queda de rede — e a idade do dado
// no rodapé mostra que ele envelheceu.
//
// Contrato que a TV ainda não viu dispara a comemoração (Comemoracao.tsx). O
// que já foi visto fica no localStorage, para recarregar a página não comemorar
// de novo; TV sem nada guardado semeia em silêncio na primeira busca.
// `/tv?comemorar` comemora o mais recente, para conferir o visual.
//
// Teclado: setas trocam de tela, espaço pausa, R recarrega das fontes.

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Pause, Play, RefreshCw } from "lucide-react";

import { chaveDoFechado, fechadosNovos, type TelaTv, type TvData, type TvFechado } from "@/lib/tv";
import { Comemoracao } from "@/components/tv/Comemoracao";
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

function useDados(aoChegar: (r: Resposta) => void) {
	const [dados, setDados] = useState<Resposta | null>(null);
	const [falhou, setFalhou] = useState(false);
	const [buscadoEm, setBuscadoEm] = useState<Date | null>(null);
	const buscar = useCallback(async () => {
		try {
			const r = await fetch("/api/tv", { cache: "no-store" });
			if (!r.ok) throw new Error(String(r.status));
			const resposta = (await r.json()) as Resposta;
			setDados(resposta);
			aoChegar(resposta);
			setBuscadoEm(new Date());
			setFalhou(false);
		} catch {
			setFalhou(true);
		}
	}, [aoChegar]);
	useEffect(() => {
		const primeiro = setTimeout(buscar, 0);
		const id = setInterval(buscar, BUSCA_MS);
		return () => {
			clearTimeout(primeiro);
			clearInterval(id);
		};
	}, [buscar]);
	return { dados, falhou, buscadoEm, buscar };
}

const CHAVE_VISTOS = "tv-fechados-vistos";

function lerVistos(): string[] {
	try {
		return JSON.parse(localStorage.getItem(CHAVE_VISTOS) ?? "[]") as string[];
	} catch {
		return [];
	}
}

function gravarVistos(vistos: Set<string>) {
	try {
		// Só os últimos: candidatos são os de uma semana, nunca chegam perto disso.
		localStorage.setItem(CHAVE_VISTOS, JSON.stringify([...vistos].slice(-200)));
	} catch {
		// Sem storage, vale a memória da aba (o ref): recarregar semeia de novo.
	}
}

/** Fila de contratos novos a comemorar, um de cada vez. */
function useComemoracao() {
	const vistos = useRef<Set<string> | null>(null);
	const [fila, setFila] = useState<TvFechado[]>([]);

	const aoChegar = useCallback((r: Resposta) => {
		const { fechados, candidatos } = r.fechados;
		if (!vistos.current) {
			vistos.current = new Set(lerVistos());
			const forcar = new URLSearchParams(window.location.search).has("comemorar");
			if (forcar && fechados[0]) setFila([fechados[0]]);
			if (vistos.current.size === 0) {
				// Semeia só o que comemoraria agora: linha ainda sem valor fica de
				// fora e comemora quando o valor chegar.
				for (const f of fechadosNovos(vistos.current, candidatos)) vistos.current.add(chaveDoFechado(f));
				gravarVistos(vistos.current);
				return;
			}
		}
		const novos = fechadosNovos(vistos.current, candidatos);
		if (!novos.length) return;
		for (const f of novos) vistos.current.add(chaveDoFechado(f));
		gravarVistos(vistos.current);
		setFila((atual) => [...atual, ...novos]);
	}, []);

	const proximo = useCallback(() => setFila((atual) => atual.slice(1)), []);
	return { atual: fila[0] ?? null, aoChegar, proximo };
}

/**
 * Vai às fontes como o ↻ do /dashboard (mesmo cooldown, mesma rota) e depois
 * rebusca /api/tv. Sem isto, contrato lançado agora espera o próximo agendamento.
 */
function useAtualizar(buscar: () => Promise<void>) {
	const [rodando, setRodando] = useState(false);
	const emCurso = useRef(false);
	const atualizar = useCallback(async () => {
		if (emCurso.current) return;
		emCurso.current = true;
		setRodando(true);
		try {
			await fetch("/api/dashboard/atualizar", { method: "POST" });
			await buscar();
		} finally {
			emCurso.current = false;
			setRodando(false);
		}
	}, [buscar]);
	return { rodando, atualizar };
}

/**
 * Atualizar escondido: quase da cor do fundo, de propósito — quem sabe onde
 * fica usa, quem olha a TV não vê. A tecla R faz o mesmo.
 */
function Atualizar({ rodando, clicar }: { rodando: boolean; clicar: () => void }) {
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

const horaCurta = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * Hora da última busca boa da TV, que anda de 5 em 5 min — "dados de" com a
 * hora da sincronização mais atrasada (o Pipefy, de 30 em 30) parecia TV
 * parada. A hora da fonte só aparece quando ela atrasou de verdade.
 */
function IdadeDoDado({ dados, falhou, buscadoEm, atualizando }: { dados: Resposta | null; falhou: boolean; buscadoEm: Date | null; atualizando: boolean }) {
	if (atualizando) return <span style={{ fontSize: 18, color: COR.texto }}>atualizando…</span>;
	if (!dados || !buscadoEm) return null;
	if (dados.dadoVelho || falhou) {
		const fonte = dados.ultimaAtualizacao ? horaCurta(new Date(dados.ultimaAtualizacao)) : "—";
		return (
			<span style={{ fontSize: 18, color: COR.texto }}>
				dados atrasados · {falhou ? "sem conexão desde " : "fonte de "}
				<span style={NUMERO}>{falhou ? horaCurta(buscadoEm) : fonte}</span>
			</span>
		);
	}
	return (
		<span style={{ fontSize: 18, color: COR.terciario }}>
			atualizado às <span style={NUMERO}>{horaCurta(buscadoEm)}</span>
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
	const comemoracao = useComemoracao();
	const { dados, falhou, buscadoEm, buscar } = useDados(comemoracao.aoChegar);
	const { rodando: atualizando, atualizar } = useAtualizar(buscar);
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

	// Setas navegam como slide (e reiniciam os 18 s da tela); espaço pausa;
	// R recarrega das fontes (o ↻ escondido do rodapé).
	useEffect(() => {
		const n = telas.length;
		const tecla = (e: KeyboardEvent) => {
			if (e.key === "r" || e.key === "R") void atualizar();
			else if (e.key === " ") {
				e.preventDefault();
				setPausado((p) => !p);
			} else if (n < 2) return;
			else if (e.key === "ArrowRight") irPara((indice + 1) % n);
			else if (e.key === "ArrowLeft") irPara((indice - 1 + n) % n);
		};
		window.addEventListener("keydown", tecla);
		return () => window.removeEventListener("keydown", tecla);
	}, [indice, telas.length, irPara, atualizar]);

	return (
		<div style={{ width: "100vw", height: "56.25vw", overflow: "hidden", position: "relative" }}>
			<div
				style={{
					width: 1920,
					height: 1080,
					transform: `scale(${escala})`,
					transformOrigin: "top left",
					position: "relative",
					background: "#FFFFFF",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 80, flexShrink: 0, padding: "0 64px", borderBottom: `1px solid ${COR.linha}` }}>
					{/* Versão preta: a TV é sempre tema claro. O PNG tem margem branca embutida: 72px e o recuo compensam. */}
					<Image src="/logo-fluxo-preta.png" alt="Fluxo" width={72} height={72} priority style={{ marginLeft: -10 }} />
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
						<IdadeDoDado dados={dados} falhou={falhou} buscadoEm={buscadoEm} atualizando={atualizando} />
						<Atualizar rodando={atualizando} clicar={() => void atualizar()} />
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

				{comemoracao.atual && (
					<Comemoracao key={chaveDoFechado(comemoracao.atual)} f={comemoracao.atual} aoTerminar={comemoracao.proximo} />
				)}
			</div>
		</div>
	);
}
