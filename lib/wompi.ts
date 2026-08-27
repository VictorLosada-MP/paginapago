import { createHash, randomBytes } from 'node:crypto'

/**
 * Configuración y utilidades del checkout de Wompi.
 *
 * IMPORTANTE: este módulo es de uso EXCLUSIVO en el servidor. Lee
 * `WOMPI_INTEGRITY_SECRET`, que nunca debe llegar al navegador. No lo importes
 * desde un componente marcado con "use client".
 */

/**
 * Wompi Colombia liquida únicamente en pesos colombianos (COP), así que el
 * cobro SIEMPRE se hace en COP aunque el precio se haya comunicado en USD.
 */
export const CURRENCY = 'COP' as const

/**
 * Monto del cobro en CENTAVOS de peso colombiano.
 *
 * Ejemplo: 250000000 centavos = $2.500.000 COP.
 *
 * Si el precio original de la oferta estaba en USD, hay que convertirlo a COP
 * a la tasa que se quiera fijar y escribir aquí el resultado en centavos:
 * Wompi no acepta USD para comercios colombianos.
 *
 * Se puede sobreescribir con la variable de entorno `WOMPI_AMOUNT_IN_CENTS`
 * para no tener que tocar el código cada vez que cambie el precio.
 */
export const AMOUNT_IN_CENTS = Number.parseInt(
  process.env.WOMPI_AMOUNT_IN_CENTS ?? '250000000',
  10,
)

/** Prefijo de la referencia de pago, ej: `VICTOR-20260825-ABC123`. */
const REFERENCE_PREFIX = process.env.WOMPI_REFERENCE_PREFIX ?? 'VICTOR'

/** Página de Agradecimiento a la que Wompi redirige al terminar el pago. */
const THANK_YOU_URL =
  process.env.NEXT_PUBLIC_THANK_YOU_URL ?? 'https://pageagradecimiento.vercel.app/'

export type CheckoutSession = {
  /** Llave PÚBLICA de Wompi (`pub_test_...` en Sandbox, `pub_prod_...` en producción). */
  publicKey: string
  currency: typeof CURRENCY
  amountInCents: number
  /** Referencia única e irrepetible de este pago. */
  reference: string
  /** Firma de integridad calculada en el backend. */
  signature: string
  redirectUrl: string
}

/** Formatea centavos de COP como `$2.500.000 COP`. */
export function formatCOP(amountInCents: number): string {
  const pesos = Math.round(amountInCents / 100)
  return `$${new Intl.NumberFormat('es-CO').format(pesos)} COP`
}

/**
 * Genera una referencia única por pago con el formato `PREFIJO-YYYYMMDD-XXXXXX`.
 * Wompi rechaza una referencia que ya haya sido usada por una transacción
 * aprobada, por eso el sufijo es aleatorio y no un contador.
 */
function generateReference(): string {
  const now = new Date()
  const date = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('')

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const suffix = Array.from(randomBytes(6), (byte) => alphabet[byte % alphabet.length]).join('')

  return `${REFERENCE_PREFIX}-${date}-${suffix}`
}

/**
 * Firma de integridad exigida por Wompi:
 *
 *   SHA256(referencia + monto_en_centavos + moneda + INTEGRITY_SECRET)
 *
 * Se calcula siempre en el servidor: el secreto de integridad jamás se expone
 * al frontend.
 */
export function buildIntegritySignature(
  reference: string,
  amountInCents: number,
  currency: string,
  integritySecret: string,
): string {
  return createHash('sha256')
    .update(`${reference}${amountInCents}${currency}${integritySecret}`)
    .digest('hex')
}

/**
 * Arma los datos que el frontend necesita para renderizar el Widget de Wompi.
 * Lanza si faltan las variables de entorno obligatorias.
 */
export function createCheckoutSession(): CheckoutSession {
  const publicKey = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET

  if (!publicKey) {
    throw new Error('Falta la variable de entorno NEXT_PUBLIC_WOMPI_PUBLIC_KEY')
  }
  if (!integritySecret) {
    throw new Error('Falta la variable de entorno WOMPI_INTEGRITY_SECRET')
  }
  if (!Number.isInteger(AMOUNT_IN_CENTS) || AMOUNT_IN_CENTS <= 0) {
    throw new Error(
      `WOMPI_AMOUNT_IN_CENTS debe ser un entero de centavos mayor a 0 (valor recibido: ${process.env.WOMPI_AMOUNT_IN_CENTS})`,
    )
  }

  const reference = generateReference()

  return {
    publicKey,
    currency: CURRENCY,
    amountInCents: AMOUNT_IN_CENTS,
    reference,
    signature: buildIntegritySignature(reference, AMOUNT_IN_CENTS, CURRENCY, integritySecret),
    redirectUrl: THANK_YOU_URL,
  }
}
