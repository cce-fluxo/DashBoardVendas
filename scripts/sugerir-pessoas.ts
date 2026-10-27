// scripts/sugerir-pessoas.ts
//
// Monta a primeira versão da base de pessoas (migration 0011) a partir das
// grafias que já estão em `vendedor`.
//
// O QUE É AUTOMÁTICO E O QUE NÃO É
//
//   · Nome com 2+ palavras vira pessoa sozinho, e grafias que só diferem em
//     acento ou caixa caem na mesma pessoa. Grafia `gestao` vazia (vale sempre).
//   · Apelido (1 palavra: "Jonas", "Rafa") NUNCA é ligado automaticamente. O
//     mesmo apelido aparece em 23/24 e 24/25 sem garantia de ser a mesma pessoa,
//     e ligar errado funde dois rankings sem erro nenhum. O script só SUGERE
//     candidatos pelo primeiro nome.
//   · Nome contido em outro ("Gabriel Pereira" ⊂ "Gabriel Santos Pereira") também
//     só vira sugestão.
//
// FLUXO
//
//   1. npx tsx scripts/sugerir-pessoas.ts
//        → escreve pessoas-sugeridas.csv. Não grava nada no banco.
//   2. Revise o CSV: preencha `nome_exibicao` onde quiser ligar (copie de
//      `sugestao` ou escreva), e `gestao` quando a grafia só valer numa gestão.
//      Linha com `nome_exibicao` vazio é ignorada.
//   3. npx tsx scripts/sugerir-pessoas.ts --aplicar pessoas-sugeridas.csv
//        → grava pessoa + pessoa_grafia. Idempotente: rodar de novo não duplica.
//
// EQUIPES DE PROJETO (--equipe)
//
//   npx tsx scripts/sugerir-pessoas.ts --equipe
//     → lê gerente e consultores da planilha de projetos (FONTE_ENTREGAS) e
//       escreve pessoas-equipe.csv só com quem ainda não resolve para pessoa.
//       Mesmo nome de uma pessoa existente já vem preenchido; parecido (mesmo
//       primeiro nome e mais uma palavra) e apelido só sugerem. Aplica-se com
//       o mesmo --aplicar.
//
// Existe UM banco, o de produção. O passo 3 escreve nele.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { normalizarNomeVendedor } from "../src/lib/fontes/mapear";
import { FONTE_ENTREGAS } from "../src/lib/fontes/registry";
import { lerEntregas } from "../src/lib/fontes/sheets-fonte";
import { buscarGrafias } from "../src/lib/pessoas";

const SEP = ";";
const COLUNAS = [
	"grafia",
	"gestoes",
	"contratos",
	"cards",
	"acao",
	"sugestao",
	"nome_exibicao",
	"gestao",
] as const;
type Linha = Record<(typeof COLUNAS)[number], string>;

function supabase() {
	for (const v of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
		if (!process.env[v]) throw new Error(`${v} é obrigatório no .env.local`);
	}
	return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/** Sem acento e sem caixa: "Lívia" e "Livia" são a mesma grafia. */
function chave(nome: string): string {
	return nome.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** "Agatha Maria de Araújo Frossard Ferreira" → "Agatha Ferreira". */
function nomeCurto(nome: string): string {
	const p = nome.split(/\s+/);
	return p.length <= 2 ? nome : `${p[0]} ${p[p.length - 1]}`;
}

async function paginar<T>(
	tabela: string,
	colunas: string,
	ordem: string,
): Promise<T[]> {
	const db = supabase();
	const todas: T[] = [];
	for (let i = 0; ; i += 1000) {
		const { data, error } = await db
			.from(tabela)
			.select(colunas)
			.order(ordem, { ascending: true })
			.range(i, i + 999);
		if (error) throw new Error(`${tabela}: ${error.message}`);
		todas.push(...((data ?? []) as T[]));
		if ((data ?? []).length < 1000) return todas;
	}
}

async function sugerir() {
	const [vendedores, vinculos, cards] = await Promise.all([
		paginar<{ id_vendedor: number; nome_vendedor: string }>(
			"vendedor", "id_vendedor, nome_vendedor", "id_vendedor",
		),
		paginar<{ id_vendedor: number; id_projeto: number; projeto_vendido: { gestao: string } | null }>(
			"projeto_vendedor", "id_vendedor, id_projeto, projeto_vendido ( gestao )", "id_projeto",
		),
		paginar<{ id_vendedor: number; id_card: number }>(
			"card_vendedor", "id_vendedor, id_card", "id_card",
		),
	]);

	const gestoes = new Map<number, Set<string>>();
	const contratos = new Map<number, number>();
	for (const v of vinculos) {
		const g = v.projeto_vendido?.gestao;
		if (g) gestoes.set(v.id_vendedor, (gestoes.get(v.id_vendedor) ?? new Set()).add(g));
		contratos.set(v.id_vendedor, (contratos.get(v.id_vendedor) ?? 0) + 1);
	}
	const nCards = new Map<number, number>();
	for (const c of cards) nCards.set(c.id_vendedor, (nCards.get(c.id_vendedor) ?? 0) + 1);

	// Uma pessoa por nome completo (2+ palavras), agrupando variações de acento.
	const completos = vendedores.filter((v) => v.nome_vendedor.split(/\s+/).length >= 2);
	const pessoaPorChave = new Map<string, string>();
	for (const v of completos) {
		const k = chave(v.nome_vendedor);
		if (!pessoaPorChave.has(k)) pessoaPorChave.set(k, nomeCurto(v.nome_vendedor));
	}

	// Nome curto repetido entre pessoas diferentes violaria o UNIQUE de
	// nome_exibicao — e, pior, fundiria as duas no ranking. Fica para um humano.
	const usos = new Map<string, number>();
	for (const n of pessoaPorChave.values()) usos.set(n, (usos.get(n) ?? 0) + 1);

	const linhas: Linha[] = vendedores.map((v) => {
		const nome = v.nome_vendedor;
		const partes = chave(nome).split(/\s+/);
		const base = {
			grafia: nome,
			gestoes: [...(gestoes.get(v.id_vendedor) ?? [])].sort().join(" "),
			contratos: String(contratos.get(v.id_vendedor) ?? 0),
			cards: String(nCards.get(v.id_vendedor) ?? 0),
			gestao: "",
		};

		if (partes.length >= 2) {
			const curto = pessoaPorChave.get(chave(nome))!;
			const contidoEm = completos
				.map((o) => o.nome_vendedor)
				.filter((o) => {
					const op = chave(o).split(/\s+/);
					return op.length > partes.length && partes.every((p) => op.includes(p));
				});
			if (usos.get(curto)! > 1) {
				return { ...base, acao: "conflito de nome curto", sugestao: curto, nome_exibicao: "" };
			}
			if (contidoEm.length > 0) {
				return {
					...base,
					acao: "sugerir (nome contido em outro)",
					sugestao: contidoEm.map((o) => pessoaPorChave.get(chave(o))).join(" | "),
					nome_exibicao: curto,
				};
			}
			return { ...base, acao: "ligar", sugestao: "", nome_exibicao: curto };
		}

		const candidatos = [
			...new Set(
				completos
					.filter((o) => chave(o.nome_vendedor).split(/\s+/)[0] === partes[0])
					.map((o) => pessoaPorChave.get(chave(o.nome_vendedor))!),
			),
		];
		return {
			...base,
			acao: candidatos.length ? "sugerir (apelido)" : "sozinha",
			sugestao: candidatos.join(" | "),
			nome_exibicao: "",
			// Apelido só vale na gestão onde apareceu — é o que separa dois "Rafa".
			gestao: (gestoes.get(v.id_vendedor)?.size ?? 0) === 1 ? [...gestoes.get(v.id_vendedor)!][0] : "",
		};
	});

	linhas.sort((a, b) => a.acao.localeCompare(b.acao) || a.grafia.localeCompare(b.grafia));
	const csv = [COLUNAS.join(SEP), ...linhas.map((l) => COLUNAS.map((c) => l[c]).join(SEP))].join("\n");
	writeFileSync("pessoas-sugeridas.csv", csv + "\n");

	const por = (a: string) => linhas.filter((l) => l.acao.startsWith(a)).length;
	console.log(`${vendedores.length} grafias → pessoas-sugeridas.csv (nada foi gravado)`);
	console.log(`  ligar automaticamente: ${por("ligar")}`);
	console.log(`  sugestões para revisar: ${por("sugerir")}`);
	console.log(`  conflitos de nome curto: ${por("conflito")}`);
	console.log(`  sem candidato: ${por("sozinha")}`);
}

async function sugerirEquipe() {
	const lidos = await lerEntregas(FONTE_ENTREGAS);
	const projetos = new Map<string, number>();
	for (const p of lidos.flatMap((l) => l.projetos)) {
		for (const n of p.equipe) {
			const nome = normalizarNomeVendedor(n);
			projetos.set(nome, (projetos.get(nome) ?? 0) + 1);
		}
	}

	const grafias = await buscarGrafias();
	// Pela grafia, não pelo resolvedor: ele devolve o próprio nome quando não acha
	// — e também quando acha uma pessoa cujo nome de exibição é igual à grafia.
	// Grafia com gestão conta como ligada: apelido só vale onde foi cadastrado.
	const ligadas = new Set(grafias.map((g) => normalizarNomeVendedor(g.grafia)));
	const existentes = new Map(grafias.map((g) => [chave(g.nomeExibicao), g.nomeExibicao]));
	const faltam = [...projetos.keys()].filter((n) => !ligadas.has(n));

	// Nome curto novo que bate com pessoa existente, ou com outra pessoa nova,
	// fundiria duas pessoas: fica para um humano.
	const usos = new Map<string, number>();
	for (const n of faltam) {
		if (n.split(/\s+/).length >= 2 && !existentes.has(chave(n))) {
			const c = chave(nomeCurto(n));
			usos.set(c, (usos.get(c) ?? 0) + 1);
		}
	}

	const linhas: Linha[] = faltam.map((nome) => {
		const base = { grafia: nome, gestoes: "", contratos: String(projetos.get(nome)), cards: "", gestao: "" };
		const partes = chave(nome).split(/\s+/);
		const mesmo = existentes.get(chave(nome));
		if (mesmo) return { ...base, acao: "ligar (mesmo nome de pessoa existente)", sugestao: "", nome_exibicao: mesmo };
		const parecidos = [...existentes.values()].filter((e) => {
			const q = chave(e).split(/\s+/);
			return q[0] === partes[0] && (partes.length === 1 || q.slice(1).some((w) => partes.includes(w)));
		});
		if (partes.length === 1) return { ...base, acao: "sugerir (apelido)", sugestao: parecidos.join(" | "), nome_exibicao: "" };
		if (parecidos.length) return { ...base, acao: "sugerir (parecido com pessoa existente)", sugestao: parecidos.join(" | "), nome_exibicao: "" };
		const curto = nomeCurto(nome);
		if (existentes.has(chave(curto)) || usos.get(chave(curto))! > 1) {
			return { ...base, acao: "conflito de nome curto", sugestao: curto, nome_exibicao: "" };
		}
		return { ...base, acao: "nova pessoa", sugestao: "", nome_exibicao: curto };
	});

	linhas.sort((a, b) => a.acao.localeCompare(b.acao) || a.grafia.localeCompare(b.grafia));
	// `contratos` aqui é o número de projetos em que a pessoa aparece.
	const csv = [COLUNAS.join(SEP), ...linhas.map((l) => COLUNAS.map((c) => l[c]).join(SEP))].join("\n");
	writeFileSync("pessoas-equipe.csv", csv + "\n");

	const por = (a: string) => linhas.filter((l) => l.acao.startsWith(a)).length;
	console.log(`${projetos.size} nomes nas equipes, ${faltam.length} sem pessoa → pessoas-equipe.csv (nada foi gravado)`);
	console.log(`  mesmo nome de pessoa existente: ${por("ligar")}`);
	console.log(`  pessoa nova: ${por("nova")}`);
	console.log(`  sugestões para revisar: ${por("sugerir")}`);
	console.log(`  conflitos de nome curto: ${por("conflito")}`);
}

async function aplicar(arquivo: string) {
	const [cabecalho, ...resto] = readFileSync(arquivo, "utf8").trim().split("\n");
	const cols = cabecalho.split(SEP);
	const linhas = resto
		.map((r) => Object.fromEntries(r.split(SEP).map((v, i) => [cols[i], v.trim()])) as Linha)
		.filter((l) => l.nome_exibicao);

	const db = supabase();
	const nomes = [...new Set(linhas.map((l) => l.nome_exibicao))];
	const { data: pessoas, error } = await db
		.from("pessoa")
		.upsert(nomes.map((nome_exibicao) => ({ nome_exibicao })), { onConflict: "nome_exibicao" })
		.select("id_pessoa, nome_exibicao");
	if (error) throw new Error(`pessoa: ${error.message}`);
	const id = new Map(pessoas!.map((p) => [p.nome_exibicao as string, p.id_pessoa as number]));

	const { error: erroGrafia } = await db.from("pessoa_grafia").upsert(
		linhas.map((l) => ({
			id_pessoa: id.get(l.nome_exibicao)!,
			grafia: normalizarNomeVendedor(l.grafia),
			gestao: l.gestao || null,
		})),
		// Rodar de novo com o CSV corrigido MOVE a grafia para a pessoa nova.
		{ onConflict: "grafia,gestao" },
	);
	if (erroGrafia) throw new Error(`pessoa_grafia: ${erroGrafia.message}`);

	console.log(`${nomes.length} pessoa(s), ${linhas.length} grafia(s) gravadas.`);
	console.log("Pessoa que ficou sem grafia não é apagada: limpe no Table Editor se for o caso.");
}

const i = process.argv.indexOf("--aplicar");
const tarefa =
	i >= 0
		? aplicar(process.argv[i + 1] ?? "pessoas-sugeridas.csv")
		: process.argv.includes("--equipe")
			? sugerirEquipe()
			: sugerir();
tarefa.catch((err) => {
	console.error("\nErro fatal:", err?.message ?? err);
	process.exit(1);
});
