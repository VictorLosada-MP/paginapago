import { createHash, randomBytes } from 'node:crypto'

/**
 * Configuración y utilidades del checkout de Wompi.
 *
 * IMPORTANTE: este módulo es de uso EXCLUSIVO en el servidor. Lee
 * `WOMPI_INTEGRITY_SECRET`, que nunca debe llegar al navegador. No lo importes
 * desde un componente marcado con "use client".
 */

/**
 * Moneda con la que se COBRA.
 *
 * El precio se fija y se muestra en USD (ver `PRICE_IN_USD_CENTS`), pero Wompi
 * Colombia solo liquida en pesos colombianos: el cargo real siempre sale en COP.
 */
export const CURRENCY = 'COP' as const

/** Precio de la oferta en CENTAVOS de dólar. 250000 = US$2,500.00 */
export const PRICE_IN_USD_CENTS = Number.parseInt(
  process.env.PRICE_IN_USD_CENTS ?? '250000',
  10,
)

/**
 * Pesos colombianos por cada dólar, usada para convertir el precio a COP.
 *
 * Es una tasa FIJA a propósito: consultar una API de divisas en cada pago
 * metería una dependencia externa que puede caerse justo en el checkout, y
 * haría que el precio bailara entre una visita y otra. Hay que revisarla a mano
 * cuando la tasa se mueva (variable `USD_TO_COP_RATE`).
 */
export const USD_TO_COP_RATE = Number.parseFloat(process.env.USD_TO_COP_RATE ?? '4000')

/**
 * Monto del cargo en CENTAVOS de peso colombiano.
 *
 * centavos_usd / 100 = dólares → dólares * tasa = pesos → pesos * 100 = centavos_cop
 * que se simplifica a centavos_usd * tasa.
 */
export const AMOUNT_IN_CENTS = Math.round(PRICE_IN_USD_CENTS * USD_TO_COP_RATE)

/** Prefijo de la referencia de pago, ej: `VICTOR-20260825-ABC123`. */
const REFERENCE_PREFIX = process.env.WOMPI_REFERENCE_PREFIX ?? 'VICTOR'

/** Página de Agradecimiento. Solo se llega ahí si la transacción quedó APPROVED. */
export const THANK_YOU_URL =
  process.env.NEXT_PUBLIC_THANK_YOU_URL ?? 'https://pageagradecimiento.vercel.app/'

/**
 * Métodos de pago que puede elegir el usuario.
 *
 * Todos se cobran por Wompi; lo que cambia es qué opciones le muestra el modal
 * y el texto del botón. Los códigos son los que acepta el widget:
 * CARD, NEQUI, BANCOLOMBIA_TRANSFER, BANCOLOMBIA_COLLECT, PSE.
 *
 * Van como string separado por comas, NO como array: el widget hace
 * `paymentMethods.split(",")` y con un array revienta con
 * "e.split is not a function" sin abrir el modal.
 */
export const PAYMENT_METHODS = {
  card: {
    label: 'Tarjeta de crédito/débito',
    buttonLabel: 'Pagar con tarjeta',
    wompiMethods: 'CARD',
  },
  bank: {
    label: 'Transferencia bancaria',
    buttonLabel: 'Pagar con transferencia bancaria',
    wompiMethods: 'PSE,BANCOLOMBIA_TRANSFER,BANCOLOMBIA_COLLECT',
  },
} as const

export type PaymentMethodId = keyof typeof PAYMENT_METHODS

export function isPaymentMethodId(value: unknown): value is PaymentMethodId {
  return typeof value === 'string' && value in PAYMENT_METHODS
}

/** Direcciones que no son alcanzables desde internet. */
const LOCAL_HOSTNAME = /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/

/**
 * ¿Se puede llegar a este origen desde internet?
 *
 * Importa porque Wompi RECHAZA con 403 el checkout cuando `redirect-url` apunta
 * a una dirección local o privada (comprobado con localhost, 127.0.0.1 y
 * 192.168.x.x; con un dominio público responde 200). El iframe del widget
 * nunca carga y el modal se queda girando para siempre, sin ningún error
 * visible en la página.
 *
 * Por eso en desarrollo local el `redirectUrl` simplemente no se manda: los
 * pagos con tarjeta se resuelven por el callback del widget, que no necesita
 * redirección. Los que salen de la página (PSE, Bancolombia) sí la necesitan,
 * así que para probarlos de punta a punta hace falta una URL pública —un
 * preview de Vercel o un túnel tipo ngrok—, no localhost.
 */
export function isPubliclyRoutableOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return !LOCAL_HOSTNAME.test(hostname) && hostname.includes('.')
  } catch {
    return false
  }
}

export type CheckoutSession = {
  /** Llave PÚBLICA de Wompi. Es la única llave que puede ver el navegador. */
  publicKey: string
  currency: typeof CURRENCY
  amountInCents: number
  /** Referencia única de este intento de pago. */
  reference: string
  /** Firma de integridad calculada en el backend. */
  signature: string
  /**
   * A dónde vuelve Wompi cuando el pago sale de la página (PSE, Bancolombia).
   * Apunta a nuestra propia pantalla de estado, NO a la de agradecimiento:
   * ahí se verifica contra la API de Wompi si la transacción quedó aprobada.
   *
   * Se omite en desarrollo local (ver `isPubliclyRoutableOrigin`).
   */
  redirectUrl?: string
  /** Métodos que se le muestran al usuario dentro del modal, separados por comas. */
  paymentMethods: string
}

/** Formatea centavos de COP como `$10.000.000 COP`. */
export function formatCOP(amountInCents: number): string {
  const pesos = Math.round(amountInCents / 100)
  return `$${new Intl.NumberFormat('es-CO').format(pesos)} COP`
}

/** Formatea centavos de USD como `US$2,500`. */
export function formatUSD(amountInCents: number): string {
  const dollars = amountInCents / 100
  const hasCents = amountInCents % 100 !== 0
  return `US$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(dollars)}`
}

/**
 * Genera una referencia única por intento con el formato `PREFIJO-YYYYMMDD-XXXXXX`.
 * Wompi rechaza una referencia ya usada por una transacción aprobada, por eso el
 * sufijo es aleatorio y no un contador.
 *
 * También la usa el checkout de cripto como `order_id`, para que una venta se
 * pueda rastrear igual sin importar por dónde se pagó.
 */
export function generateReference(): string {
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
 * Arma los datos que el frontend necesita para abrir el Widget de Wompi.
 * Lanza si faltan las variables de entorno obligatorias.
 */
export function createCheckoutSession(
  method: PaymentMethodId,
  origin: string,
): CheckoutSession {
  const publicKey = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET

  if (!publicKey) {
    throw new Error('Falta la variable de entorno NEXT_PUBLIC_WOMPI_PUBLIC_KEY')
  }
  if (!integritySecret) {
    throw new Error('Falta la variable de entorno WOMPI_INTEGRITY_SECRET')
  }
  if (!Number.isFinite(USD_TO_COP_RATE) || USD_TO_COP_RATE <= 0) {
    throw new Error(
      `USD_TO_COP_RATE debe ser un número mayor a 0 (valor recibido: ${process.env.USD_TO_COP_RATE})`,
    )
  }
  if (!Number.isInteger(AMOUNT_IN_CENTS) || AMOUNT_IN_CENTS <= 0) {
    throw new Error(
      `El monto en centavos de COP no es válido (${AMOUNT_IN_CENTS}). Revisa PRICE_IN_USD_CENTS y USD_TO_COP_RATE.`,
    )
  }

  const reference = generateReference()

  return {
    publicKey,
    currency: CURRENCY,
    amountInCents: AMOUNT_IN_CENTS,
    reference,
    signature: buildIntegritySignature(reference, AMOUNT_IN_CENTS, CURRENCY, integritySecret),
    ...(isPubliclyRoutableOrigin(origin)
      ? { redirectUrl: new URL('/pago/estado', origin).toString() }
      : {}),
    paymentMethods: PAYMENT_METHODS[method].wompiMethods,
  }
}
