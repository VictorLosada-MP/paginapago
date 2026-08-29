import { Check, ShieldCheck, Clock } from "lucide-react"

import { WompiCheckout } from "@/components/wompi-checkout"
import { CRYPTO_ENABLED } from "@/lib/nowpayments"
import {
  AMOUNT_IN_CENTS,
  PRICE_IN_USD_CENTS,
  THANK_YOU_URL,
  formatCOP,
  formatUSD,
} from "@/lib/wompi"

// El precio se fija y se muestra en dólares, pero Wompi Colombia solo liquida
// en pesos: el cargo real sale en COP. Se muestran los dos para que nadie se
// lleve una sorpresa en el extracto. Ambos salen del mismo sitio que firma el
// backend, así que no se pueden desincronizar.
const PRECIO_USD = formatUSD(PRICE_IN_USD_CENTS)
const PRECIO_COP = formatCOP(AMOUNT_IN_CENTS)

const incluye = [
  "Sistema a medida construido para tu negocio",
  "Acceso a las herramientas para generar ventas y contenido",
  "2 sesiones de capacitación (1 hora cada una)",
  "Material de apoyo sencillo",
  "1 sesión de seguimiento a los 15 días",
]

export function CheckoutCard() {
  return (
    <div className="w-full max-w-xl">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="p-6 sm:p-10">
          {/* Título */}
          <header className="mb-8">
            <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Confirmación de pago
            </p>
            <h1 className="text-pretty text-3xl font-semibold leading-tight text-foreground sm:text-4xl">
              Confirma tu inversión
            </h1>
          </header>

          {/* Resumen de la oferta */}
          <section className="mb-8">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">Estás adquiriendo:</h2>
            <ul className="flex flex-col gap-3">
              {incluye.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
                  </span>
                  <span className="text-sm leading-relaxed text-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Forma de pago */}
          <section className="mb-8 rounded-xl border border-border bg-secondary/60 p-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-muted-foreground">Inversión total</span>
              <span className="text-2xl font-semibold tracking-tight text-foreground">
                {PRECIO_USD}
              </span>
            </div>
            <p className="mt-2 text-right text-xs leading-relaxed text-muted-foreground">
              Se cobra {PRECIO_COP}
            </p>
          </section>

          {/* Qué ocurre después del pago */}
          <section className="mb-8 flex items-start gap-3">
            <Clock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 className="mb-1 text-sm font-medium text-foreground">Qué ocurre después del pago</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Una vez confirmado el pago, te contactaré en un máximo de 24 horas para iniciar el
                diagnóstico y definir los siguientes pasos del proceso.
              </p>
            </div>
          </section>

          {/* Métodos de pago + botón, ambos del checkout de Wompi */}
          <WompiCheckout
            amountInCents={AMOUNT_IN_CENTS}
            thankYouUrl={THANK_YOU_URL}
            cryptoEnabled={CRYPTO_ENABLED}
          />

          {/* Nota de confianza */}
          <div className="mt-6 flex items-start gap-3 border-t border-border pt-6">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              Este no es un proceso de entrega y desaparición. El objetivo es que quedes con tu
              propio sistema y con la capacidad real de usarlo y mejorarlo de forma independiente.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
