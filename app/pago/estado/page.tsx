import { AlertCircle, Clock } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { THANK_YOU_URL } from '@/lib/wompi'

/**
 * Pantalla de retorno de Wompi.
 *
 * Wompi manda aquí (`?id=<transacción>&env=<test|prod>`) cuando el pago sale de
 * la página — PSE, Bancolombia — y vuelve. Ojo: vuelve con CUALQUIER resultado,
 * también rechazado o cancelado, así que no se puede asumir que llegar aquí
 * signifique que pagaron.
 *
 * Por eso el estado se consulta contra la API de Wompi y solo una transacción
 * APPROVED pasa a la Página de Agradecimiento. Nada de lo que venga en la URL
 * se toma como prueba de pago.
 */

export const dynamic = 'force-dynamic'

type TransactionStatus = 'APPROVED' | 'DECLINED' | 'VOIDED' | 'ERROR' | 'PENDING'

async function fetchTransactionStatus(
  id: string,
  env: string,
): Promise<TransactionStatus | null> {
  // `env` sale de la llave pública usada (pub_test_… / pub_prod_…).
  const baseUrl =
    env === 'prod' ? 'https://production.wompi.co/v1' : 'https://sandbox.wompi.co/v1'

  try {
    const response = await fetch(`${baseUrl}/transactions/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: { status?: TransactionStatus } }
    return body.data?.status ?? null
  } catch (error) {
    console.error('[wompi] No se pudo consultar la transacción:', error)
    return null
  }
}

const MESSAGES: Record<
  Exclude<TransactionStatus, 'APPROVED'> | 'UNKNOWN',
  { title: string; description: string; icon: typeof AlertCircle }
> = {
  PENDING: {
    title: 'Tu pago está en proceso',
    description:
      'El banco todavía no confirma la transacción. Puede tardar unos minutos; te escribiré apenas quede confirmada.',
    icon: Clock,
  },
  DECLINED: {
    title: 'El pago fue rechazado',
    description:
      'No se hizo ningún cobro. Puedes volver a intentarlo con otro método o con otra tarjeta.',
    icon: AlertCircle,
  },
  VOIDED: {
    title: 'El pago fue anulado',
    description: 'No se hizo ningún cobro. Puedes volver a intentarlo cuando quieras.',
    icon: AlertCircle,
  },
  ERROR: {
    title: 'Hubo un error con el pago',
    description:
      'No se pudo completar la transacción y no se hizo ningún cobro. Puedes volver a intentarlo.',
    icon: AlertCircle,
  },
  UNKNOWN: {
    title: 'No pudimos confirmar tu pago',
    description:
      'No logramos verificar el estado de la transacción. Si el dinero salió de tu cuenta, escríbeme y lo reviso.',
    icon: AlertCircle,
  },
}

export default async function EstadoDelPagoPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; env?: string }>
}) {
  const { id, env = 'test' } = await searchParams

  if (!id) {
    redirect('/')
  }

  const status = await fetchTransactionStatus(id, env)

  if (status === 'APPROVED') {
    redirect(THANK_YOU_URL)
  }

  const { title, description, icon: Icon } = MESSAGES[status ?? 'UNKNOWN']

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-4 py-12 sm:py-16">
      <div className="w-full max-w-xl">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="p-6 sm:p-10">
            <div className="mb-6 flex items-start gap-3">
              <Icon
                className={`mt-0.5 size-6 shrink-0 ${
                  status === 'PENDING' ? 'text-primary' : 'text-destructive'
                }`}
                aria-hidden="true"
              />
              <div>
                <h1 className="text-pretty text-2xl font-semibold leading-tight text-foreground">
                  {title}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            </div>

            <p className="mb-8 border-t border-border pt-6 text-xs text-muted-foreground">
              Referencia de la transacción: <span className="font-mono">{id}</span>
            </p>

            {status !== 'PENDING' && (
              <Link
                href="/"
                className="flex w-full items-center justify-center rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                Volver a intentar el pago
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
