// src/lib/fontes/contato.ts
//
// Chave de correlação a partir de e-mail e telefone de contato, sem guardar o
// contato. A prospecção ativa e o CRM COM não têm conexão no Pipefy, e o título
// do CRM COM é "Rascunho"; o que liga os dois é o contato. Como na migration
// 0019, contato de gente de fora não vai para o banco: vai o SHA-256 do valor
// normalizado. Só servidor (node:crypto) — não importar em código de tela.

import { createHash } from "node:crypto";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function chaveEmail(email: string | null | undefined): string | null {
	const e = (email ?? "").trim().toLowerCase();
	return e.includes("@") ? sha(e) : null;
}

/**
 * Últimos 9 dígitos: "+55 21 96508-4387", "(21) 96508-4387" e "965084387" casam.
 * ponytail: ignora o DDD para casar quem digitou sem ele; dois números iguais em
 * DDDs diferentes colidiriam — raro em ~1000 cards.
 */
export function chaveTelefone(telefone: string | null | undefined): string | null {
	const d = (telefone ?? "").replace(/\D/g, "");
	return d.length >= 8 ? sha(d.slice(-9)) : null;
}
