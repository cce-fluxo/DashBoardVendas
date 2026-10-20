import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Suíte de testes de LÓGICA pura (regras de negócio em src/lib).
// Não precisa de DOM nem de React — só Node. O alias "@/" espelha o tsconfig
// para que os imports de "@/types", "@/lib/..." resolvam igual ao app.
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
