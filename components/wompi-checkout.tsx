'use client'

import { Building2, CreditCard, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

const WIDGET_SRC = 'https://checkout.wompi.co/widget.js'

/** Debe coincidir con PAYMENT_METHODS de `lib/wompi.ts`. */
const METHODS = [
  { id: 'card', label: 'Tarjeta de crédito/débito', buttonLabel: 'Pagar con tarjeta', icon: CreditCard },
  { id: 'bank', label: 'Transferencia bancaria', buttonLabel: 'Pagar con transferencia bancaria', icon: Building2 },
] as const

type MethodId = (typeof METHODS)[number]['id']

type CheckoutSession = {
  publicKey: string
  currency: string
  amountInCents: number
  reference: string
  signature: string
  redirectUrl: string
  paymentMethods: string
}

/** Lo que devuelve el widget en el callback de `open()`. */
type WompiTransaction = { id: string; status?: string } | null | undefined

type WidgetCheckoutInstance = { open: (cb: (result: { transaction: WompiTransaction }) => void) => void }

declare global {
  interface Window {
    WidgetCheckout?: new (options: Record<string, unknown>) => WidgetCheckoutInstance
  }
}

const ERROR_BY_STATUS: Record<string, string> = {
  DECLINED: 'El pago fue rechazado. Puedes intentarlo de nuevo o con otro método.',
  VOIDED: 'El pago fue anulado. Puedes intentarlo de nuevo.',
  ERROR: 'Hubo un error procesando el pago. Puedes intentarlo de nuevo.',
}

/**
 * Checkout de Wompi con método de pago seleccionable.
 *
 * Usa `WidgetCheckout`, la API JavaScript del widget oficial. Frente a la
 * versión por atributos `data-*` esto cambia dos cosas que importan:
 *
 *  - El botón es nuestro, así que su texto refleja el método elegido en vez del
 *    genérico "Paga con Wompi". El modal de pago sigue siendo 100% de Wompi.
 *  - Al pasarle un callback a `open()`, el widget NOS entrega el resultado en
 *    vez de redirigir por su cuenta. Sin callback redirige a `redirectUrl`
 *    SIEMPRE, incluso si el pago se rechazó o el usuario canceló, que es
 *    justo lo que mandaba gente sin pagar a la página de agradecimiento.
 *
 * Los pagos que salen de la página (PSE, Bancolombia) no pueden volver por el
 * callback, así que vuelven a `redirectUrl` → `/pago/estado`, que verifica el
 * estado real contra la API de Wompi antes de dejar pasar a agradecimiento.
 */
export function WompiCheckout({
  amountInCents,
  thankYouUrl,
}: {
  amountInCents: number
  thankYouUrl: string
}) {
  const [method, setMethod] = useState<MethodId>('card')
  const [session, setSession] = useState<CheckoutSession | null>(null)
  const [widgetReady, setWidgetReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Evita que una respuesta lenta de un método pise la del método actual.
  const requestId = useRef(0)

  const fetchSession = useCallback(
    async (methodId: MethodId, signal?: AbortSignal) => {
      const id = ++requestId.current
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: methodId, amountInCents }),
        signal,
      })
      if (!response.ok) throw new Error(`El backend respondió ${response.status}`)
      const data = (await response.json()) as CheckoutSession
      if (id === requestId.current) setSession(data)
    },
    [amountInCents],
  )

  // Carga el script del widget una sola vez.
  useEffect(() => {
    if (window.WidgetCheckout) {
      setWidgetReady(true)
      return
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${WIDGET_SRC}"]`)
    const script = existing ?? document.createElement('script')
    const onLoad = () => setWidgetReady(true)
    const onError = () =>
      setError('No pudimos cargar la pasarela de pago. Revisa tu conexión e inténtalo de nuevo.')

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    if (!existing) {
      script.src = WIDGET_SRC
      script.async = true
      document.head.appendChild(script)
    }
    return () => {
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }
  }, [])

  // Pide una sesión nueva cada vez que cambia el método, para que la firma
  // corresponda siempre al método que se va a abrir.
  useEffect(() => {
    const controller = new AbortController()
    setSession(null)
    fetchSession(method, controller.signal).catch((cause) => {
      if (controller.signal.aborted) return
      console.error('[wompi] No se pudo preparar el checkout:', cause)
      setError('No pudimos preparar el pago. Recarga la página e inténtalo de nuevo.')
    })
    return () => controller.abort()
  }, [method, fetchSession])

  function handlePay() {
    if (!session || !window.WidgetCheckout) return
    setError(null)

    const checkout = new window.WidgetCheckout({
      currency: session.currency,
      amountInCents: session.amountInCents,
      reference: session.reference,
      publicKey: session.publicKey,
      signature: { integrity: session.signature },
      redirectUrl: session.redirectUrl,
      paymentMethods: session.paymentMethods,
    })

    // No se bloquea el botón mientras el modal está abierto: Wompi no siempre
    // invoca el callback cuando el usuario cierra el modal sin pagar, así que
    // un estado "abriendo…" se quedaría pegado para siempre. El modal tapa la
    // página de todos modos.
    checkout.open((result) => {
      const status = result?.transaction?.status

      if (status === 'APPROVED') {
        window.location.assign(thankYouUrl)
        return
      }

      // Cancelado (sin transacción) o pendiente: no es un error que mostrar,
      // pero sí hace falta una referencia nueva para el siguiente intento.
      if (status && status !== 'PENDING') {
        setError(ERROR_BY_STATUS[status] ?? 'El pago no se pudo completar. Inténtalo de nuevo.')
      }

      fetchSession(method).catch(() => {
        setError('No pudimos preparar un nuevo intento. Recarga la página.')
      })
    })
  }

  const selected = METHODS.find((m) => m.id === method) ?? METHODS[0]
  const disabled = !session || !widgetReady

  return (
    <>
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Elige tu método de pago</h2>
        <div
          role="radiogroup"
          aria-label="Método de pago"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {METHODS.map(({ id, label, icon: Icon }) => {
            const isSelected = id === method
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setMethod(id)}
                className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                  isSelected
                    ? 'border-primary bg-accent'
                    : 'border-border bg-background hover:bg-secondary'
                }`}
              >
                <Icon
                  className={`size-4 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                  aria-hidden="true"
                />
                <span className="text-sm leading-tight text-foreground">{label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <button
        type="button"
        onClick={handlePay}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disabled && !error ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Preparando el pago seguro…
          </>
        ) : (
          selected.buttonLabel
        )}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-relaxed text-destructive"
        >
          {error}
        </p>
      )}
    </>
  )
}
