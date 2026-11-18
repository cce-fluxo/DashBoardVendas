// src/lib/outbound.ts
//
// Competição de outbound da TV: Time Cellbit × Time Manu. DEFINIÇÃO ÚNICA dos
// times, das fases do pipe de prospecção e da regra de pontos. Puro e sem rede.
//
// Pontos são CUMULATIVOS por card, pela etapa mais avançada que ele alcançou:
// ligou (+1), marcou diagnóstico (+2), diagnóstico realizado (+3), proposta (+5),
// venda (+30). Um card ligado, diagnosticado e com proposta vale 11, não 5. Pular
// fase não perde ponto: card que foi direto para "Reunião marcada" também ligou.
//
// Depois do diagnóstico o lead vai para o CRM COM, e os dois pipes não têm
// conexão no Pipefy. A ligação é feita aqui (`correlacionar`), por hash de
// e-mail, hash de telefone ou nome da empresa.
//
// Ponto de prospecção vale pela fase ATUAL do card (voltar de fase tira o ponto;
// Encerrado mantém o que o histórico alcançou).
//
// Pontos vão para o "SDR responsável" do card, não para os `assignees`: estes
// incluem os líderes, que não competem.

import { ETAPAS_CANONICAS } from "@/lib/fontes/pipes";
import { normalizarCabecalho } from "@/lib/fontes/normalizar";
import { iniciais, type ResolverPessoa } from "@/lib/pessoas";

export const PIPE_PROSPECCAO = "307434892";

/** Fases do pipe, na ordem. Fase fora desta lista vira rejeição na sincronização. */
export const FASES_PROSPECCAO = [
	"Base a abordar",
	"D1 · Tentativa",
	"D2 · Prova de par",
	"D3 · Provocação",
	"D4 · Break-up",
	"Em conversa / retornar em data",
	"Reunião marcada (nutrição)",
	"No-show / remarcar",
	"Diagnóstico realizado",
	"Encerrado",
] as const;

/** Membros pelo `nome_exibicao` da base de pessoas (migration 0020 liga as grafias do Pipefy). */
export const TIMES = [
	{ nome: "Time Cellbit", membros: ["Bernardo Mourelle", "Miguel Antonio", "Peterson Carvalho", "Mirella Reis", "Mariana Peixoto"] },
	{ nome: "Time Manu", membros: ["Felipe Onoda", "João Marcelo", "Nicoly Santos", "Mariana Rocha", "Anna Julia"] },
] as const;

export const MARCOS = [
	{ chave: "ligacoes", rotulo: "Ligações", pontos: 1 },
	{ chave: "diagsMarcados", rotulo: "Diagnósticos marcados", pontos: 2 },
	{ chave: "diagsRealizados", rotulo: "Diagnósticos realizados", pontos: 3 },
	{ chave: "propostas", rotulo: "Propostas", pontos: 5 },
	{ chave: "vendas", rotulo: "Vendas", pontos: 30 },
] as const;

type Marco = (typeof MARCOS)[number]["chave"];

export interface CardProspeccao {
	pipefy_id: string;
	empresa: string | null;
	email_hash: string | null;
	telefone_hash: string | null;
	sdr: string | null;
	etapa_atual?: string | null;
	data_criacao: string | null;
	fases: { fase: string; em: string }[];
}

/** O que importa de um card do CRM COM. Campos opcionais: card gravado antes da 0020. */
export interface CardCrm {
	pipefy_id: string;
	empresa?: string | null;
	email_hash?: string | null;
	telefone_hash?: string | null;
	data_criacao: string | null;
	etapa_atual: string;
	historico: { etapa: string }[];
}

// ─── Nível de um card (0 a 5 = quantos marcos alcançou) ───────────

const NAO_LIGOU = new Set(["Start form", "Base a abordar"]);
const MARCOU = new Set(["Reunião marcada (nutrição)", "No-show / remarcar", "Diagnóstico realizado"]);

function nivelProspeccao(c: CardProspeccao): number {
	// Card arrastado de volta (ex.: Reunião marcada → D1) vale pela fase onde está:
	// o histórico guarda a passagem, mas o Pipefy mostra o card atrás. "Encerrado"
	// é saída, não retrocesso: segue pelo histórico.
	const atual = c.etapa_atual;
	const fases = atual && atual !== "Encerrado" ? [atual] : c.fases.map((f) => f.fase);
	if (fases.includes("Diagnóstico realizado")) return 3;
	if (fases.some((f) => MARCOU.has(f))) return 2;
	// "Encerrado" direto da base é descarte da lista, não ligação.
	if (fases.some((f) => !NAO_LIGOU.has(f) && f !== "Encerrado")) return 1;
	return 0;
}

const IDX = (e: string) => ETAPAS_CANONICAS.indexOf(e as (typeof ETAPAS_CANONICAS)[number]);

function nivelCrm(c: CardCrm): number {
	const max = Math.max(IDX(c.etapa_atual), ...c.historico.map((h) => IDX(h.etapa)));
	if (max >= IDX("Venda")) return 5;
	if (max >= IDX("Proposta comercial feita")) return 4;
	if (max >= IDX("Diagnóstico feito")) return 3;
	return 0;
}

export function pontosDoNivel(nivel: number): number {
	return MARCOS.slice(0, nivel).reduce((s, m) => s + m.pontos, 0);
}

// ─── Correlação prospecção → CRM COM ──────────────────────────────

/** ponytail: igualdade após normalizar; "Tecma Ltda" ≠ "Tecma". Fuzzy se o casamento falhar muito. */
function chaveEmpresa(e: string | null | undefined): string | null {
	const n = normalizarCabecalho(e ?? "").replace(/[^a-z0-9]+/g, " ").trim();
	return n.length >= 3 ? n : null;
}

const tempo = (iso: string | null) => (iso ? Date.parse(iso) : 0);

/**
 * Nível vindo do CRM COM para cada card de prospecção (pipefy_id → nível).
 *
 * Cada card do CRM COM credita UM card de prospecção — a empresa com dois
 * contatos abordados não ganha a proposta em dobro. Só casa card do CRM criado
 * depois do de prospecção: lead inbound antigo da mesma empresa não é mérito do
 * outbound. Prioridade: e-mail, telefone, empresa; entre candidatos, o mais
 * avançado na prospecção e, empatado, o mais antigo.
 */
export function correlacionar(prosp: CardProspeccao[], crm: CardCrm[]): Map<string, number> {
	const nivel = new Map(prosp.map((p) => [p.pipefy_id, nivelProspeccao(p)]));
	const melhor = (cands: CardProspeccao[]) =>
		[...cands].sort(
			(a, b) => nivel.get(b.pipefy_id)! - nivel.get(a.pipefy_id)! || tempo(a.data_criacao) - tempo(b.data_criacao) || a.pipefy_id.localeCompare(b.pipefy_id),
		)[0];

	const resultado = new Map<string, number>();
	for (const c of crm) {
		const n = nivelCrm(c);
		if (n === 0) continue;
		const antes = prosp.filter((p) => tempo(p.data_criacao) <= tempo(c.data_criacao));
		const emp = chaveEmpresa(c.empresa);
		const escolhido =
			(c.email_hash && melhor(antes.filter((p) => p.email_hash === c.email_hash))) ||
			(c.telefone_hash && melhor(antes.filter((p) => p.telefone_hash === c.telefone_hash))) ||
			(emp && melhor(antes.filter((p) => chaveEmpresa(p.empresa) === emp)));
		if (escolhido) resultado.set(escolhido.pipefy_id, Math.max(n, resultado.get(escolhido.pipefy_id) ?? 0));
	}
	return resultado;
}

// ─── Placar ───────────────────────────────────────────────────────

export interface OutboundMembro {
	nome: string;
	iniciais: string;
	foto: string | null;
	pontos: number;
}

export interface OutboundTime {
	nome: string;
	pontos: number;
	membros: OutboundMembro[];
	/** Cards que alcançaram cada marco. */
	marcos: Record<Marco, number>;
}

export interface Outbound {
	times: OutboundTime[];
}

export function montarOutbound(
	prosp: CardProspeccao[],
	crm: CardCrm[],
	resolver: ResolverPessoa,
	fotos: Map<string, string>,
): Outbound {
	const doCrm = correlacionar(prosp, crm);
	const porPessoa = new Map<string, { pontos: number; niveis: number[] }>();
	for (const p of prosp) {
		if (!p.sdr) continue;
		const nome = resolver(p.sdr, null);
		const n = Math.max(nivelProspeccao(p), doCrm.get(p.pipefy_id) ?? 0);
		const atual = porPessoa.get(nome) ?? { pontos: 0, niveis: [] };
		atual.pontos += pontosDoNivel(n);
		atual.niveis.push(n);
		porPessoa.set(nome, atual);
	}

	return {
		times: TIMES.map((t) => {
			const membros = t.membros.map((nome) => ({
				nome,
				iniciais: iniciais(nome),
				foto: fotos.get(nome) ?? null,
				pontos: porPessoa.get(nome)?.pontos ?? 0,
			}));
			const niveis = t.membros.flatMap((nome) => porPessoa.get(nome)?.niveis ?? []);
			return {
				nome: t.nome,
				pontos: membros.reduce((s, m) => s + m.pontos, 0),
				membros: membros.sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome, "pt-BR")),
				marcos: Object.fromEntries(MARCOS.map((m, i) => [m.chave, niveis.filter((n) => n > i).length])) as Record<Marco, number>,
			};
		}),
	};
}
