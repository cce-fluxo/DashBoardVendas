"use client";

import { useCallback, useEffect, useState } from "react";
import { Menu, RefreshCw, ShieldCheck, ShieldAlert } from "lucide-react";

import { Sidebar } from "@/components/dashboard/Sidebar";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { ConferirNumero } from "@/components/dashboard/ConferirNumero";
import { gestaoAtual } from "@/lib/periodo-gestao";
import type { EstadoAuditoria, Pendencia } from "@/lib/auditoria/coletar";

// ─── Formatação ───────────────────────────────────────────────────

function dataHora(iso: string | null) {
	if (!iso) return "—";
	return new Date(iso).toLocaleString("pt-BR", {
		day: "2-digit",
		month: "2-digit",
		year: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		timeZone: "America/Sao_Paulo",
	});
}

function dataCurta(iso: string | null) {
	if (!iso) return "—";
	return new Date(iso).toLocaleDateString("pt-BR", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		timeZone: "America/Sao_Paulo",
	});
}

function reais(v: number) {
	return v.toLocaleString("pt-BR", {
		style: "currency",
		currency: "BRL",
		maximumFractionDigits: 0,
	});
}

function diasDesde(iso: string) {
	const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
	if (d <= 0) return "hoje";
	return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

// ─── Peças ────────────────────────────────────────────────────────

function Secao({
	titulo,
	explicacao,
	children,
}: {
	titulo: string;
	explicacao: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
				<p className="text-[11px] text-foreground/40 mt-0.5 max-w-3xl leading-relaxed">
					{explicacao}
				</p>
			</div>
			{children}
		</section>
	);
}

function Tabela({ children }: { children: React.ReactNode }) {
	// Tabela larga rola dentro do próprio contêiner — a página nunca rola na
	// horizontal.
	return (
		<div className="overflow-x-auto rounded-xl border border-foreground/[0.08]">
			<table className="w-full text-xs">{children}</table>
		</div>
	);
}

const TH = "text-left font-medium text-foreground/40 px-3 py-2 whitespace-nowrap";
const TD = "px-3 py-2 align-top border-t border-foreground/[0.06]";

function StatusExecucao({ status }: { status: string }) {
	const cor =
		status === "ok"
			? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
			: status === "com_erros"
				? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"
				: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25";
	return (
		<span
			className={`text-[9px] font-medium px-2 py-0.5 rounded-full border ${cor}`}
		>
			{status}
		</span>
	);
}

function LinhaPendencia({ p }: { p: Pendencia }) {
	const [aberto, setAberto] = useState(false);
	return (
		<>
			<tr className="hover:bg-foreground/[0.02]">
				<td className={TD}>
					<span className="text-foreground/80">{p.motivo}</span>
					{/* O campo só aparece quando ACRESCENTA — em "campo obrigatório sem
					    valor: projeto" ele já está dito, e repetir vira ruído. */}
					{p.campo && !p.motivo.includes(p.campo) && (
						<span className="text-foreground/30 ml-2">({p.campo})</span>
					)}
				</td>
				<td className={TD} title={p.origemRef}>
					<span className="text-foreground/60 whitespace-nowrap">
						{p.fonteNome}
					</span>
					<span className="text-foreground/35 font-mono text-[10px] ml-2 whitespace-nowrap">
						{p.local}
					</span>
				</td>
				<td className={`${TD} whitespace-nowrap`}>
					<span className="text-foreground/70">{diasDesde(p.primeiraEm)}</span>
					<span className="text-foreground/30 ml-1.5">
						({dataCurta(p.primeiraEm)})
					</span>
				</td>
				<td className={`${TD} text-right tabular-nums text-foreground/50`}>
					{p.ocorrencias}
				</td>
				<td className={TD}>
					{p.payload != null && (
						<button
							onClick={() => setAberto((v) => !v)}
							className="text-[10px] text-primary hover:underline"
						>
							{aberto ? "ocultar" : "ver origem"}
						</button>
					)}
				</td>
			</tr>
			{aberto && (
				<tr>
					<td colSpan={5} className="px-3 pb-3 bg-foreground/[0.02]">
						<pre className="text-[10px] text-foreground/60 overflow-x-auto p-2 rounded-lg bg-foreground/[0.04]">
							{JSON.stringify(p.payload, null, 2)}
						</pre>
					</td>
				</tr>
			)}
		</>
	);
}

// ─── Página ───────────────────────────────────────────────────────

export default function AuditoriaPage() {
	const [dados, setDados] = useState<EstadoAuditoria | null>(null);
	const [carregando, setCarregando] = useState(true);
	const [erro, setErro] = useState<string | null>(null);
	const [sidebarAberta, setSidebarAberta] = useState(false);
	const [atualizando, setAtualizando] = useState(false);
	const [aviso, setAviso] = useState<string | null>(null);

	const carregar = useCallback(async () => {
		try {
			const r = await fetch("/api/dashboard/auditoria", { cache: "no-store" });
			if (!r.ok) throw new Error(String(r.status));
			setDados(await r.json());
			setErro(null);
		} catch (e) {
			setErro(e instanceof Error ? e.message : "erro");
		} finally {
			setCarregando(false);
		}
	}, []);

	useEffect(() => {
		// Dentro de uma função própria: o estado só muda depois do await, e não no
		// corpo do efeito. Chamar `carregar()` direto aqui faz o React avisar de
		// renderização em cascata — o aviso é falso neste caso, mas o formato
		// abaixo é o que deixa isso explícito para quem lê.
		void (async () => {
			await carregar();
		})();
	}, [carregar]);

	/**
	 * Reler as FONTES e recarregar esta tela.
	 *
	 * É aqui que a rejeição aparece, então é aqui que o conserto precisa poder
	 * ser conferido. Sem este botão o ciclo era: ver o erro, corrigir a planilha,
	 * esperar o cron do dia seguinte para descobrir se resolveu.
	 */
	const atualizarFontes = useCallback(async () => {
		setAtualizando(true);
		setAviso(null);
		try {
			const r = await fetch("/api/dashboard/atualizar", { method: "POST" });
			const j = await r.json();
			if (j.estado === "recente") setAviso("Já atualizado agora há pouco");
			else if (j.estado === "em_andamento") setAviso("Já tem uma atualização em andamento");
			else if (!r.ok || j.estado === "erro") setAviso("Não foi possível atualizar");
		} catch {
			setAviso("Não foi possível atualizar");
		} finally {
			await carregar();
			setAtualizando(false);
		}
	}, [carregar]);

	const saudavel =
		dados != null &&
		dados.indisponivel.length === 0 &&
		dados.execucoes.every((e) => e.status === "ok") &&
		dados.cobertura.every((c) => c.confereComOCodigo);

	return (
		<div className="min-h-screen bg-background">
			<header className="fixed top-0 left-0 right-0 h-16 border-b border-foreground/[0.06] bg-background/80 backdrop-blur z-30 flex items-center justify-between px-4 md:pl-[236px] md:pr-8">
				<button
					onClick={() => setSidebarAberta(true)}
					className="md:hidden text-foreground/60"
					aria-label="Abrir menu"
				>
					<Menu size={20} />
				</button>
				<div className="flex items-center gap-3 ml-auto">
					{aviso && (
						<span className="hidden sm:block text-[10px] text-foreground/45 text-right leading-tight max-w-[190px]">
							{aviso}
						</span>
					)}
					<ThemeToggle />
					<button
						onClick={atualizarFontes}
						disabled={atualizando}
						title="Reler Pipefy e planilhas agora"
						aria-label="Atualizar dados a partir das fontes"
						className="p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors disabled:opacity-40"
					>
						<RefreshCw
							size={14}
							className={`text-foreground/40 ${atualizando ? "animate-spin" : ""}`}
						/>
					</button>
				</div>
			</header>

			{/* A auditoria não filtra por coordenação nem por período: ela descreve
			    o ESTADO DA INGESTÃO, que é o mesmo para qualquer recorte. */}
			<Sidebar
				coordenacoesAtivas={["CCE", "ACE", "MNP", "QAB", "PRO"]}
				onToggleCoordenacao={() => {}}
				gestaoAtual={gestaoAtual()}
				periodoAtivo="—"
				isOpen={sidebarAberta}
				onClose={() => setSidebarAberta(false)}
			/>

			<main className="ml-0 md:ml-[220px] mt-16 px-4 md:px-8 py-8 flex flex-col gap-10 max-w-[1400px]">
				<div>
					<div className="flex items-center gap-2">
						<h1 className="text-xl md:text-2xl font-semibold text-foreground">
							Auditoria
						</h1>
						{!carregando &&
							dados &&
							(saudavel ? (
								<ShieldCheck size={18} className="text-emerald-500" />
							) : (
								<ShieldAlert size={18} className="text-amber-500" />
							))}
					</div>
					<p className="text-xs md:text-sm text-foreground/40 mt-1 max-w-3xl">
						De onde vem cada número, o que a fonte deixou de entregar e o que já
						está fechado. Esta tela existe para que a pergunta &ldquo;posso
						confiar nisto?&rdquo; tenha resposta sem precisar do terminal.
					</p>
				</div>

				{carregando && (
					<div className="flex flex-col gap-3">
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-40 w-full" />
					</div>
				)}

				{erro && (
					<div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
						<p className="text-xs text-red-700 dark:text-red-300">
							Não foi possível carregar a auditoria (HTTP {erro}).
						</p>
					</div>
				)}

				{dados && (
					<>
						{/* O que NÃO pôde ser lido vem primeiro: ausência de resposta não
						    é resposta positiva. */}
						{dados.indisponivel.length > 0 && (
							<div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
								<p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
									{dados.indisponivel.length} verificação(ões) não puderam ser
									feitas
								</p>
								<ul className="mt-1.5 flex flex-col gap-0.5">
									{dados.indisponivel.map((i) => (
										<li
											key={i}
											className="text-[11px] text-amber-700/80 dark:text-amber-300/80"
										>
											· {i}
										</li>
									))}
								</ul>
								<p className="text-[10px] text-amber-700/60 dark:text-amber-300/60 mt-1.5">
									Não confunda com &ldquo;está tudo certo&rdquo;: estes pontos
									não foram checados.
								</p>
							</div>
						)}

						<Secao
							titulo="Conferir um número"
							explicacao="Escolha um período e veja os contratos que somam o total, cada um com a linha da planilha de onde saiu. É o que transforma discordar do dash em conferir uma linha, em vez de desconfiar do sistema inteiro."
						>
							<ConferirNumero />
						</Secao>

						<Secao
							titulo="Última carga de cada fonte"
							explicacao="Se a carga mais recente de uma fonte falhou, o dado dela parou no tempo — e a tela continua mostrando números, só que velhos. É a diferença entre um dash desatualizado e um dash que avisa que está desatualizado."
						>
							<Tabela>
								<thead>
									<tr>
										<th className={TH}>Fonte</th>
										<th className={TH}>Status</th>
										<th className={TH}>Quando</th>
										<th className={TH}>Gatilho</th>
										<th className={`${TH} text-right`}>Lidas</th>
										<th className={`${TH} text-right`}>Gravadas</th>
										<th className={`${TH} text-right`}>Sem novidade</th>
										<th className={`${TH} text-right`}>Rejeitadas</th>
									</tr>
								</thead>
								<tbody>
									{dados.execucoes.map((e) => (
										<tr key={e.idExecucao} className="hover:bg-foreground/[0.02]">
											<td className={`${TD} whitespace-nowrap font-medium`}>
												{e.fonteNome}
											</td>
											<td className={TD}>
												<StatusExecucao status={e.status} />
												{e.erro && (
													<p className="text-[10px] text-foreground/40 mt-1 max-w-md">
														{e.erro}
													</p>
												)}
											</td>
											<td className={`${TD} whitespace-nowrap text-foreground/60`}>
												{dataHora(e.terminadoEm ?? e.iniciadoEm)}
											</td>
											<td className={`${TD} text-foreground/45`}>
												{e.disparadoPor}
											</td>
											<td className={`${TD} text-right tabular-nums`}>{e.lidas}</td>
											<td className={`${TD} text-right tabular-nums`}>
												{e.aceitas}
											</td>
											<td
												className={`${TD} text-right tabular-nums text-foreground/45`}
											>
												{e.ignoradas}
											</td>
											<td
												className={`${TD} text-right tabular-nums ${
													e.rejeitadas > 0 ? "text-amber-600" : "text-foreground/45"
												}`}
											>
												{e.rejeitadas}
											</td>
										</tr>
									))}
								</tbody>
							</Tabela>
						</Secao>

						<Secao
							titulo={`Pendências da fonte (${dados.pendencias.length})`}
							explicacao="Linhas que a planilha ou o Pipefy não entregaram em condições de usar. Cada linha aqui é UM problema, não uma ocorrência: o mesmo campo vazio reaparece a cada carga, e listar todas as repetições transformaria a lista em ruído. O que importa é há quanto tempo o problema resiste."
						>
							{dados.pendencias.length === 0 ? (
								<p className="text-xs text-foreground/40">
									Nenhuma pendência — toda linha das fontes entrou.
								</p>
							) : (
								<Tabela>
									<thead>
										<tr>
											<th className={TH}>Problema</th>
											<th className={TH}>Origem</th>
											<th className={TH}>Desde</th>
											<th className={`${TH} text-right`}>Rodadas</th>
											<th className={TH}></th>
										</tr>
									</thead>
									<tbody>
										{dados.pendencias.map((p) => (
											<LinhaPendencia key={`${p.origemRef}|${p.motivo}`} p={p} />
										))}
									</tbody>
								</Tabela>
							)}
						</Secao>

						<Secao
							titulo="Cobertura das fontes"
							explicacao="Em que janela cada fonte foi o sistema de registro. É o que separa “não aconteceu” de “não foi medido” — out–dez/2023 não tem funil porque não havia CRM no ar, não porque ninguém vendeu."
						>
							<Tabela>
								<thead>
									<tr>
										<th className={TH}>Fonte</th>
										<th className={TH}>Gestão</th>
										<th className={TH}>De</th>
										<th className={TH}>Até</th>
										<th className={TH}>Observação</th>
									</tr>
								</thead>
								<tbody>
									{dados.cobertura.map((c) => (
										<tr
											key={`${c.fonteRef}-${c.gestao}`}
											className="hover:bg-foreground/[0.02]"
										>
											<td className={`${TD} whitespace-nowrap font-medium`}>
												{c.fonteNome}
												{!c.confereComOCodigo && (
													<span
														className="ml-2 text-[9px] text-amber-600"
														title="O que está gravado no banco não bate com a declaração no código. Rode: npx tsx scripts/registrar-cobertura.ts"
													>
														⚠ desatualizada
													</span>
												)}
											</td>
											<td className={`${TD} text-foreground/60`}>
												{c.gestao ?? "todas"}
											</td>
											<td className={`${TD} whitespace-nowrap`}>
												{dataCurta(c.inicioReal)}
											</td>
											<td className={`${TD} whitespace-nowrap`}>
												{c.fimReal ? dataCurta(c.fimReal) : "em uso"}
											</td>
											<td className={`${TD} text-foreground/45 max-w-md`}>
												{c.observacao}
											</td>
										</tr>
									))}
								</tbody>
							</Tabela>
						</Secao>

						<Secao
							titulo={`Períodos fechados (${dados.snapshots.length})`}
							explicacao="Números congelados no fechamento. A partir daqui existe “o que a gestão fechou”, e não só “o que a planilha diz hoje”. Editar a planilha de um período congelado não muda estes valores — a tela avisa que a fonte divergiu."
						>
							{dados.snapshots.length === 0 ? (
								<p className="text-xs text-foreground/40">
									Nenhum período congelado ainda. Rode{" "}
									<code className="text-[10px]">
										npx tsx scripts/congelar-periodos.ts --gravar
									</code>
									.
								</p>
							) : (
								<Tabela>
									<thead>
										<tr>
											<th className={TH}>Gestão</th>
											<th className={TH}>Período</th>
											<th className={`${TH} text-right`}>Total vendido</th>
											<th className={`${TH} text-right`}>Projetos</th>
											<th className={TH}>Congelado em</th>
											<th className={`${TH} text-right`}>Versão</th>
										</tr>
									</thead>
									<tbody>
										{dados.snapshots.map((s) => (
											<tr key={s.idSnapshot} className="hover:bg-foreground/[0.02]">
												<td className={`${TD} font-medium`}>{s.gestao}</td>
												<td className={`${TD} text-foreground/60`}>
													{s.tipoPeriodo === "gestao"
														? "gestão inteira"
														: `${s.tipoPeriodo} ${s.periodo}`}
												</td>
												<td className={`${TD} text-right tabular-nums`}>
													{reais(s.totalVendido)}
												</td>
												<td className={`${TD} text-right tabular-nums`}>
													{s.numeroDeVendas}
												</td>
												<td className={`${TD} whitespace-nowrap text-foreground/45`}>
													{dataHora(s.geradoEm)}
												</td>
												<td
													className={`${TD} text-right tabular-nums text-foreground/45`}
												>
													v{s.versaoCalculo}
												</td>
											</tr>
										))}
									</tbody>
								</Tabela>
							)}
						</Secao>

						{dados.divergenciaMetas.length > 0 && (
							<Secao
								titulo="As duas séries de meta não batem — e não deviam"
								explicacao="A meta da gestão vem da linha “total” do bloco mensal da planilha. O bloco por coordenação soma outro valor. São recortes diferentes do planejamento, então divergir é esperado; fica aqui porque quem comparar os dois sem saber disso vai concluir que o dash está errado."
							>
								<Tabela>
									<thead>
										<tr>
											<th className={TH}>Gestão</th>
											<th className={`${TH} text-right`}>Meta da gestão</th>
											<th className={`${TH} text-right`}>
												Soma das coordenações
											</th>
											<th className={`${TH} text-right`}>Diferença</th>
										</tr>
									</thead>
									<tbody>
										{dados.divergenciaMetas.map((d) => (
											<tr key={d.gestao} className="hover:bg-foreground/[0.02]">
												<td className={`${TD} font-medium`}>{d.gestao}</td>
												<td className={`${TD} text-right tabular-nums`}>
													{reais(d.metaGeral)}
												</td>
												<td className={`${TD} text-right tabular-nums`}>
													{reais(d.somaPorCoordenacao)}
												</td>
												<td
													className={`${TD} text-right tabular-nums text-foreground/50`}
												>
													{reais(d.diferenca)}
												</td>
											</tr>
										))}
									</tbody>
								</Tabela>
							</Secao>
						)}
					</>
				)}
			</main>
		</div>
	);
}
