import { Check, ShieldCheck, Clock, Building2, CreditCard, Bitcoin } from "lucide-react"

const PRECIO = "[PRECIO]"

const incluye = [
  "Sistema a medida construido para tu negocio",
  "Acceso a las herramientas para generar ventas y contenido",
  "2 sesiones de capacitación (1 hora cada una)",
  "Material de apoyo sencillo",
  "1 sesión de seguimiento a los 15 días",
]

const metodos = [
  { icon: Building2, label: "Transferencia bancaria" },
  { icon: CreditCard, label: "Tarjeta de crédito/débito" },
  { icon: Bitcoin, label: "Crypto" },
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
                {`$${PRECIO} USD`}
              </span>
            </div>
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

          {/* Métodos de pago */}
          <section className="mb-8">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">Métodos de pago</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {metodos.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-4 py-3"
                >
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="text-sm leading-tight text-foreground">{label}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Botón principal */}
          <button
            type="button"
            className="w-full rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          >
            Realizar Pago
          </button>

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
