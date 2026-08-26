'use client'

import { useEffect, useRef, useState } from 'react'

const WIDGET_SRC = 'https://checkout.wompi.co/widget.js'

type CheckoutSession = {
  publicKey: string
  currency: string
  amountInCents: number
  reference: string
  signature: string
  redirectUrl: string
}

/**
 * Botón de pago del Widget oficial de Wompi.
 *
 * Flujo:
 *   1. Al montar, le pide al backend (`/api/checkout`) la referencia única,
 *      la firma de integridad y el monto.
 *   2. Con esos datos inyecta el script del Widget dentro de un <form>, que es
 *      lo que hace que Wompi renderice su propio botón de pago.
 *   3. Al pagar, Wompi redirige a la Página de Agradecimiento.
 *
 * El frontend solo maneja datos públicos: llave pública, referencia, monto y
 * la firma ya generada en el servidor.
 */
export function WompiPayButton({ amountInCents }: { amountInCents: number }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [session, setSession] = useState<CheckoutSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadSession() {
      try {
        const response = await fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amountInCents }),
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`El backend respondió ${response.status}`)
        }

        setSession((await response.json()) as CheckoutSession)
      } catch (cause) {
        if (controller.signal.aborted) return
        console.error('[wompi] No se pudo preparar el checkout:', cause)
        setError('No pudimos preparar el pago. Recarga la página e inténtalo de nuevo.')
      }
    }

    loadSession()
    return () => controller.abort()
  }, [amountInCents])

  useEffect(() => {
    const form = formRef.current
    if (!session || !form) return

    const script = document.createElement('script')
    script.src = WIDGET_SRC
    script.setAttribute('data-render', 'button')
    script.setAttribute('data-public-key', session.publicKey)
    script.setAttribute('data-currency', session.currency)
    script.setAttribute('data-amount-in-cents', String(session.amountInCents))
    script.setAttribute('data-reference', session.reference)
    // El nombre del atributo lleva dos puntos, por eso se asigna con setAttribute.
    script.setAttribute('data-signature:integrity', session.signature)
    script.setAttribute('data-redirect-url', session.redirectUrl)

    // Si el script del widget no carga (red caída, bloqueador de anuncios) el
    // usuario se quedaría mirando un hueco: mejor decírselo.
    script.addEventListener('error', () => {
      setError('No pudimos cargar la pasarela de pago. Revisa tu conexión e inténtalo de nuevo.')
    })

    form.appendChild(script)

    // Limpia el botón que inyecta el widget para no duplicarlo (React monta y
    // desmonta los efectos dos veces en desarrollo).
    return () => {
      form.replaceChildren()
    }
  }, [session])

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-4 text-sm leading-relaxed text-destructive"
      >
        {error}
      </p>
    )
  }

  return (
    <div data-wompi-widget className="min-h-14">
      {session ? (
        <form ref={formRef} />
      ) : (
        <div
          aria-live="polite"
          className="flex h-14 w-full items-center justify-center rounded-xl bg-secondary text-base font-semibold text-muted-foreground"
        >
          Preparando el pago seguro…
        </div>
      )}
    </div>
  )
}
