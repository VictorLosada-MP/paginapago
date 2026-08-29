'use client'

import { Bitcoin, Building2, CreditCard, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

const WIDGET_SRC = 'https://checkout.wompi.co/widget.js'
const WIDGET_TIMEOUT_MS = 10_000

const BLOCKED_MESSAGE =
  'No pudimos cargar la pasarela de pago. Suele pasar cuando un bloqueador de anuncios o una extensión de seguridad bloquea checkout.wompi.co: desactívala para este sitio y vuelve a intentar.'

/**
 * Carga el script del widget una sola vez para toda la app.
 *
 * Vive fuera del componente a propósito: al ser una promesa compartida, los
 * montajes dobles de React en desarrollo reutilizan la misma carga en vez de
 * competir por los listeners del mismo <script>.
 *
 * No basta con escuchar `load` y `error`. Un bloqueador puede:
 *  - responder 200 con el cuerpo vacío → `load` se dispara pero WidgetCheckout
 *    nunca queda definido, y el botón queda activo sin hacer nada al pulsarlo;
 *  - dejar la petición colgada → no se dispara ni `load` ni `error`, y el botón
 *    se queda girando en "Preparando…" para siempre.
 * Por eso se verifica que WidgetCheckout exista de verdad y se pone un tope de
 * tiempo.
 */
let widgetPromise: Promise<void> | null = null

function loadWidget(): Promise<void> {
  if (window.WidgetCheckout) return Promise.resolve()
  if (widgetPromise) return widgetPromise

  widgetPromise = new Promise<void>((resolve, reject) => {
    const fail = () => {
      // Se limpia para que un reintento vuelva a pedir el script.
      widgetPromise = null
      reject(new Error('No se pudo cargar el widget de Wompi'))
    }

    const script = document.createElement('script')
    script.src = WIDGET_SRC
    script.async = true
    script.onload = () => (window.WidgetCheckout ? resolve() : fail())
    script.onerror = fail
    document.head.appendChild(script)

    setTimeout(() => {
      if (!window.WidgetCheckout) fail()
    }, WIDGET_TIMEOUT_MS)
  })

  return widgetPromise
}

/**
 * Métodos disponibles. `card` y `bank` los cobra Wompi (ver PAYMENT_METHODS en
 * `lib/wompi.ts`); `crypto` va por NOWPayments, que es otra pasarela y otro
 * flujo: en vez de abrir un modal, redirige a una factura alojada por ellos.
 *
 * Crypto solo se puede seleccionar si la pasarela está configurada en el
 * servidor; si no, se muestra como "Próximamente" en vez de ofrecer un pago
 * que no existe.
 */
const METHODS = [
  { id: 'card', label: 'Tarjeta de crédito/débito', buttonLabel: 'Pagar con tarjeta', icon: CreditCard },
  { id: 'bank', label: 'Transferencia bancaria', buttonLabel: 'Pagar con transferencia bancaria', icon: Building2 },
  { id: 'crypto', label: 'Crypto', buttonLabel: 'Pagar con crypto', icon: Bitcoin },
] as const

type MethodId = (typeof METHODS)[number]['id']

/** Los que firma el backend de Wompi. */
type WompiMethodId = 'card' | 'bank'

type CheckoutSession = {
  publicKey: string
  currency: string
  amountInCents: number
  reference: string
  signature: string
  redirectUrl?: string
  paymentMethods: string
  webCheckoutUrl?: string
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
  cryptoEnabled = false,
}: {
  amountInCents: number
  thankYouUrl: string
  cryptoEnabled?: boolean
}) {
  const [method, setMethod] = useState<MethodId>('card')
  const [redirecting, setRedirecting] = useState(false)
  const [session, setSession] = useState<CheckoutSession | null>(null)
  const [widgetReady, setWidgetReady] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // Evita que una respuesta lenta de un método pise la del método actual.
  const requestId = useRef(0)

  const fetchSession = useCallback(
    async (methodId: WompiMethodId, signal?: AbortSignal) => {
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

  // Carga el script del widget (compartida, ver `loadWidget`).
  useEffect(() => {
    let cancelled = false
    loadWidget()
      .then(() => {
        if (!cancelled) setWidgetReady(true)
      })
      .catch(() => {
        if (!cancelled) setError(BLOCKED_MESSAGE)
      })
    return () => {
      cancelled = true
    }
  }, [loadAttempt])

  // Pide una sesión nueva cada vez que cambia el método, para que la firma
  // corresponda siempre al método que se va a abrir.
  useEffect(() => {
    if (method === 'crypto') return
    const controller = new AbortController()
    setSession(null)
    fetchSession(method, controller.signal).catch((cause) => {
      if (controller.signal.aborted) return
      console.error('[wompi] No se pudo preparar el checkout:', cause)
      setError('No pudimos preparar el pago. Recarga la página e inténtalo de nuevo.')
    })
    return () => controller.abort()
  }, [method, fetchSession])

  /**
   * Cripto va por NOWPayments: el backend crea la factura y aquí solo se
   * redirige a su checkout alojado. No hay modal ni callback como en Wompi.
   */
  async function handleCryptoPay() {
    setError(null)
    setRedirecting(true)
    try {
      const response = await fetch('/api/crypto/checkout', { method: 'POST' })
      if (!response.ok) throw new Error(`El backend respondió ${response.status}`)
      const { invoiceUrl } = (await response.json()) as { invoiceUrl: string }
      window.location.assign(invoiceUrl)
    } catch (cause) {
      console.error('[nowpayments] No se pudo iniciar el pago:', cause)
      setError('No pudimos iniciar el pago en cripto. Inténtalo de nuevo en un momento.')
      setRedirecting(false)
    }
  }

  function handleWompiPay() {
    // Se fija el método aquí: el callback llega después y para entonces el
    // usuario pudo haber cambiado de opción.
    const wompiMethod = method === 'crypto' ? 'card' : method
    if (!session) return

    // Transferencia va por el Web Checkout de página completa: el widget no
    // acepta el código de esa fila y ni siquiera abre. Al volver, /pago/estado
    // verifica el estado real contra la API de Wompi.
    if (session.webCheckoutUrl) {
      setRedirecting(true)
      window.location.assign(session.webCheckoutUrl)
      return
    }

    // El script pudo cargar "bien" y aun así no dejar el widget disponible.
    if (!window.WidgetCheckout) {
      setError(BLOCKED_MESSAGE)
      return
    }
    setError(null)

    const checkout = new window.WidgetCheckout({
      currency: session.currency,
      amountInCents: session.amountInCents,
      reference: session.reference,
      publicKey: session.publicKey,
      signature: { integrity: session.signature },
      // En local no viene: Wompi devuelve 403 si apunta a localhost.
      ...(session.redirectUrl ? { redirectUrl: session.redirectUrl } : {}),
      // Si viene vacío hay que OMITIR la clave, no mandar "": el validador del
      // widget hace "".split(",") -> [""], no lo encuentra entre sus códigos y
      // lanza excepción sin abrir el modal. Vacío significa "no filtres".
      ...(session.paymentMethods ? { paymentMethods: session.paymentMethods } : {}),
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

      fetchSession(wompiMethod).catch(() => {
        setError('No pudimos preparar un nuevo intento. Recarga la página.')
      })
    })
  }

  const selected = METHODS.find((m) => m.id === method) ?? METHODS[0]
  const isCrypto = method === 'crypto'
  const disabled = isCrypto || redirecting ? redirecting || !session : !session || !widgetReady

  return (
    <>
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Elige tu método de pago</h2>
        <div
          role="radiogroup"
          aria-label="Método de pago"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {METHODS.map(({ id, label, icon: Icon }) => {
            const soon = id === 'crypto' && !cryptoEnabled
            const isSelected = !soon && id === method
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={soon}
                onClick={() => !soon && setMethod(id)}
                className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                  soon
                    ? 'cursor-not-allowed border-border bg-background opacity-60'
                    : isSelected
                      ? 'border-primary bg-accent'
                      : 'border-border bg-background hover:bg-secondary'
                }`}
              >
                <Icon
                  className={`size-4 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
                  aria-hidden="true"
                />
                <span className="flex flex-col leading-tight">
                  <span className="text-sm text-foreground">{label}</span>
                  {soon && (
                    <span className="text-xs text-muted-foreground">Próximamente</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <button
        type="button"
        onClick={isCrypto ? handleCryptoPay : handleWompiPay}
        disabled={disabled}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-60"
      >
        {disabled && !error ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {isCrypto || redirecting ? 'Abriendo el checkout…' : 'Preparando el pago seguro…'}
          </>
        ) : (
          selected.buttonLabel
        )}
      </button>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm leading-relaxed text-destructive"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setError(null)
              setLoadAttempt((n) => n + 1)
            }}
            className="mt-2 font-semibold underline underline-offset-4 hover:no-underline"
          >
            Reintentar
          </button>
        </div>
      )}
    </>
  )
}
