// src/app/api/dashboard/auditoria/route.ts
//
// Estado de saúde da ingestão, para /dashboard/auditoria.

import { NextResponse } from "next/server";
import { coletarAuditoria } from "@/lib/auditoria/coletar";

export async function GET() {
	try {
		return NextResponse.json(await coletarAuditoria());
	} catch (error) {
		console.error("[API Auditoria]", error);
		return NextResponse.json(
			{ message: "Erro interno ao coletar o estado da auditoria" },
			{ status: 500 },
		);
	}
}
