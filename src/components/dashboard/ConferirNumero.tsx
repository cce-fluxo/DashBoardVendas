"use client";

import { useEffect, useState } from "react";

import {
	ciclosDisponiveis,
	gestoesDisponiveis,
	mesesDisponiveis,
} from "@/lib/periodos-disponiveis";

/**
 * Drill-down: do número até a célula da planilha (F8).
 *
 * É o que fecha o objetivo "fonte auditável". Um total na tela deixa de ser um
 * número e passa a ser uma lista de contratos, cada um com a linha da planilha
 * de onde saiu. Discordar do dash vira conferir uma linha — não desconfiar do
 * sistema inteiro, que é o que acontece quando não há como olhar por dentro.
 */

interface Linha {
	projeto: string;
	coordenacao: string;
	mes: string;
	assinado: boolean;
	valorVendidoReal: number;
	canal: string;
	origemRef: string | null;
	fonteNome: string;
	local: string;
}

interface Resposta {
	total: number;
	numeroDeVendas: number;
	naoAssinadas: number;
	linhas: Linha[];
}

const reais = (v: number) =>
	v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const TH = "text-left font-medium text-foreground/40 px-3 py-2 whitespace-nowrap";
const TD = "px-3 py-2 border-t border-foreground/[0.06]";

const SELECT =
	"text-xs rounded-lg border border-foreground/[0.12] bg-background px-2.5 py-1.5 text-foreground";

export function ConferirNumero() {
	const gestoes = gestoesDisponiveis();
	const [gestao, setGestao] = useState(gestoes[0]?.valor ?? "");
	const [tipo, setTipo] = useState<"gestao" | "ciclo" | "mes">("gestao");
	const [periodo, setPeriodo] = useState("");
	const [dados, setDados] = useState<Resposta | null>(null);
	const [carregando, setCarregando] = useState(false);

	const opcoes =
		tipo === "ciclo"
			? ciclosDisponiveis(gestao)
			: tipo === "mes"
				? mesesDisponiveis(gestao)
				: [];

	// Trocar de gestão ou de tipo invalida o período escolhido — mantê-lo
	// produziria uma consulta de um recorte que não existe naquela gestão.
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- reset deliberado ao trocar gestão/tipo (ver comentário acima).
		setPeriodo(opcoes[0]?.valor ?? "");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [gestao, tipo]);

	async function conferir() {
		setCarregando(true);
		try {
			const p = new URLSearchParams({ gestao, tipo });
			if (tipo === "ciclo" && periodo) p.set("ciclo", periodo);
			if (tipo === "mes" && periodo) p.set("mes", periodo);
			const r = await fetch(`/api/dashboard/origem?${p}`);
			setDados(r.ok ? await r.json() : null);
		} finally {
			setCarregando(false);
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-end gap-2 flex-wrap">
				<select
					value={gestao}
					onChange={(e) => setGestao(e.target.value)}
					className={SELECT}
					aria-label="Gestão"
				>
					{gestoes.map((g) => (
						<option key={g.valor} value={g.valor}>
							{g.rotulo}
						</option>
					))}
				</select>

				<select
					value={tipo}
					onChange={(e) => setTipo(e.target.value as typeof tipo)}
					className={SELECT}
					aria-label="Tipo de período"
				>
					<option value="gestao">Gestão inteira</option>
					<option value="ciclo">Ciclo</option>
					<option value="mes">Mês</option>
				</select>

				{tipo !== "gestao" && (
					<select
						value={periodo}
						onChange={(e) => setPeriodo(e.target.value)}
						className={SELECT}
						aria-label="Período"
					>
						{opcoes.map((o) => (
							<option key={o.valor} value={o.valor}>
								{o.rotulo}
							</option>
						))}
					</select>
				)}

				<button
					onClick={conferir}
					disabled={carregando}
					className="text-xs rounded-lg bg-primary text-primary-foreground px-3 py-1.5 font-medium disabled:opacity-50"
				>
					{carregando ? "Buscando…" : "Ver linhas"}
				</button>
			</div>

			{dados && (
				<>
					<p className="text-xs text-foreground/60">
						<span className="font-semibold text-foreground">
							{reais(dados.total)}
						</span>{" "}
						em {dados.numeroDeVendas} contrato(s) assinado(s)
						{dados.naoAssinadas > 0 && (
							<span className="text-foreground/40">
								{" "}
								· {dados.naoAssinadas} não assinado(s) na lista, fora da soma
							</span>
						)}
					</p>

					<div className="overflow-x-auto rounded-xl border border-foreground/[0.08] max-h-[28rem] overflow-y-auto">
						<table className="w-full text-xs">
							<thead className="sticky top-0 bg-background">
								<tr>
									<th className={TH}>Projeto</th>
									<th className={TH}>Coord.</th>
									<th className={TH}>Mês</th>
									<th className={`${TH} text-right`}>Valor vendido</th>
									<th className={TH}>Origem</th>
								</tr>
							</thead>
							<tbody>
								{dados.linhas.map((l, i) => (
									<tr
										key={`${l.origemRef ?? l.projeto}-${i}`}
										className={`hover:bg-foreground/[0.02] ${
											l.assinado ? "" : "opacity-45"
										}`}
									>
										<td className={TD}>
											{l.projeto}
											{/* Não assinado fica visível de propósito: some com ele e a
											    pergunta "por que o total é menor?" fica sem resposta. */}
											{!l.assinado && (
												<span className="ml-2 text-[9px] text-foreground/40 border border-foreground/15 rounded-full px-1.5 py-0.5">
													não assinado
												</span>
											)}
										</td>
										<td className={`${TD} text-foreground/60`}>{l.coordenacao}</td>
										<td className={`${TD} text-foreground/60`}>{l.mes}</td>
										<td className={`${TD} text-right tabular-nums`}>
											{reais(l.valorVendidoReal)}
										</td>
										<td className={TD} title={l.origemRef ?? "sem procedência"}>
											<span className="text-foreground/35 font-mono text-[10px] whitespace-nowrap">
												{l.local}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</>
			)}
		</div>
	);
}
