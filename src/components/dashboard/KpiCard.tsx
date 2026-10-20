import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

// ─── Tipos ───────────────────────────────────────────────────────

interface KpiCardProps {
  titulo: string
  valor: string
  descricao?: string
  variacao?: number        // % vs gestão anterior (positivo = bom)
  meta?: {
    percentual: number     // 0–100
    gap: string            // ex: "R$ 12.345,00 para a meta"
  }
  destaque?: boolean       // card maior, valor em destaque
  loading?: boolean
}

// ─── Utilitários ─────────────────────────────────────────────────

function formatarVariacao(variacao: number) {
  const positivo = variacao >= 0
  const neutro = variacao === 0

  const cor = neutro
    ? 'text-muted-foreground'
    : positivo
    ? 'text-emerald-400'
    : 'text-red-400'

  const Icone = neutro ? Minus : positivo ? TrendingUp : TrendingDown
  const sinal = positivo && !neutro ? '+' : ''

  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${cor}`}>
      <Icone size={12} />
      {sinal}{variacao.toFixed(1)}% vs gestão anterior
    </span>
  )
}

function BarraMeta({ percentual }: { percentual: number }) {
  const cor =
    percentual >= 80 ? 'bg-emerald-400' :
    percentual >= 50 ? 'bg-amber-400' :
    'bg-red-400'

  return (
    <div className="w-full h-1.5 rounded-full bg-foreground/10 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${cor}`}
        style={{ width: `${Math.min(percentual, 100)}%` }}
      />
    </div>
  )
}

// ─── Skeleton de loading ──────────────────────────────────────────

function KpiCardSkeleton() {
  return (
    <Card className="bg-card border-foreground/[0.08]">
      <CardContent className="p-6 flex flex-col gap-3">
        <Skeleton className="h-3 w-24 bg-foreground/10" />
        <Skeleton className="h-8 w-36 bg-foreground/10" />
        <Skeleton className="h-3 w-20 bg-foreground/10" />
      </CardContent>
    </Card>
  )
}

// ─── Componente principal ─────────────────────────────────────────

export function KpiCard({
  titulo,
  valor,
  descricao,
  variacao,
  meta,
  destaque = false,
  loading = false,
}: KpiCardProps) {
  if (loading) return <KpiCardSkeleton />

  return (
    <Card
      className={`
        border rounded-xl transition-all duration-150
        ${
          destaque
            ? 'bg-primary/[0.06] border-primary/30 hover:border-primary/45'
            : 'bg-card border-foreground/[0.08] hover:border-foreground/[0.18]'
        }
      `}
    >
      <CardContent className="p-4 md:p-6 flex flex-col gap-2 md:gap-3">

        {/* Título */}
        <p className={`text-[10px] md:text-xs font-medium uppercase tracking-widest truncate ${
          destaque ? 'text-primary' : 'text-foreground/50'
        }`}>
          {titulo}
        </p>

        {/* Valor principal */}
        <p className={`font-semibold text-foreground leading-tight tabular-nums tracking-tight ${
          destaque ? 'text-2xl md:text-3xl' : 'text-lg md:text-xl'
        }`}>
          {valor}
        </p>

        {/* Barra de meta */}
        {meta && (
          <div className="flex flex-col gap-1.5">
            <BarraMeta percentual={meta.percentual} />
            <p className="text-[10px] md:text-xs text-foreground/40">{meta.gap}</p>
          </div>
        )}

        {/* Variação vs gestão anterior */}
        {variacao !== undefined && (
          <div className="mt-0.5">
            {formatarVariacao(variacao)}
          </div>
        )}

        {/* Descrição complementar */}
        {descricao && (
          <p className="text-[10px] md:text-xs text-foreground/40 leading-relaxed">
            {descricao}
          </p>
        )}

      </CardContent>
    </Card>
  )
}