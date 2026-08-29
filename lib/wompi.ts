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
  process.env.PRICE_IN_USD_CENTS?.trim() || '250000',
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
export const USD_TO_COP_RATE = Number.parseFloat(process.env.USD_TO_COP_RATE?.trim() || '4000')

/**
 * Monto del cargo en CENTAVOS de peso colombiano.
 *
 * centavos_usd / 100 = dólares → dólares * tasa = pesos → pesos * 100 = centavos_cop
 * que se simplifica a centavos_usd * tasa.
 */
export const AMOUNT_IN_CENTS = Math.round(PRICE_IN_USD_CENTS * USD_TO_COP_RATE)

/** Prefijo de la referencia de pago, ej: `VICTOR-20260825-ABC123`. */
const REFERENCE_PREFIX = process.env.WOMPI_REFERENCE_PREFIX?.trim() || 'VICTOR'

/** Página de Agradecimiento. Solo se llega ahí si la transacción quedó APPROVED. */
export const THANK_YOU_URL =
  process.env.NEXT_PUBLIC_THANK_YOU_URL?.trim() || 'https://pageagradecimiento.vercel.app/'

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
 *
 * Además, si se pide un código que el comercio NO tiene habilitado, Wompi no
 * lo ignora: devuelve la lista vacía y el modal se abre sin ninguna opción.
 * Por eso lo que se pide aquí se cruza en tiempo real con los métodos que el
 * comercio tiene de verdad (ver `fetchMerchantPaymentMethods`).
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
    wompiMethods: 'PSE,BANCOLOMBIA_TRANSFER',
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

/**
 * Códigos que el checkout de Wompi respeta de verdad en `payment-methods`.
 *
 * Comprobado renderizando el checkout real con la llave del comercio:
 *
 *   (sin filtro)                        → Transferencia / Tarjeta / Paga con crédito
 *   CARD                                → Tarjeta
 *   PSE                                 → NINGUNA
 *   BANCOLOMBIA_TRANSFER                → NINGUNA
 *   NEQUI                               → NINGUNA
 *   CARD,NEQUI,PSE,BANCOLOMBIA_TRANSFER → solo Tarjeta
 *
 * El checkout nuevo agrupa transferencias y billeteras bajo la categoría
 * "Transferencia" y ya no las reconoce por su código individual: pedirlas
 * devuelve la lista vacía. Así que el filtro solo se manda cuando TODOS los
 * códigos pedidos están aquí; si no, no se filtra y el comprador elige dentro
 * del modal de Wompi. Mostrar todas las opciones es mucho mejor que mostrar
 * ninguna.
 */
const FILTERABLE_METHODS = ['CARD']

/**
 * Métodos que el comercio tiene habilitados de verdad, según Wompi.
 *
 * El endpoint es público (no necesita llave privada) y se cachea unos minutos:
 * la lista casi nunca cambia, pero si se habilita o deshabilita un método en
 * el panel, el checkout se adapta solo sin tocar código.
 *
 * Devuelve null si no se puede consultar; en ese caso se usa la lista fija.
 */
async function fetchMerchantPaymentMethods(publicKey: string): Promise<string[] | null> {
  const baseUrl = publicKey.startsWith('pub_prod_')
    ? 'https://production.wompi.co/v1'
    : 'https://sandbox.wompi.co/v1'

  try {
    const response = await fetch(`${baseUrl}/merchants/${encodeURIComponent(publicKey)}`, {
      next: { revalidate: 300 },
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      data?: { accepted_payment_methods?: string[] }
    }
    return body.data?.accepted_payment_methods ?? null
  } catch (error) {
    console.error('[wompi] No se pudieron consultar los métodos del comercio:', error)
    return null
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
  /**
   * Métodos que se le muestran al usuario dentro del modal, separados por comas.
   * Vacío significa "no filtrar": el frontend entonces omite la opción para que
   * Wompi muestre todos los métodos del comercio.
   */
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
export async function createCheckoutSession(
  method: PaymentMethodId,
  origin: string,
): Promise<CheckoutSession> {
  // .trim() no es paranoia: al pegar una llave en el panel de Vercel es muy
  // fácil arrastrar un salto de línea invisible. Ya pasó con la llave pública
  // (42 caracteres en vez de 41), y en el secreto de integridad haría que
  // TODAS las firmas salieran mal y Wompi rechazara cada cobro.
  const publicKey = process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY?.trim()
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET?.trim()

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

  // Solo se piden los métodos que el comercio tiene habilitados: pedir uno que
  // no tenga deja el modal sin ninguna opción.
  const wanted = PAYMENT_METHODS[method].wompiMethods.split(',')
  const enabled = await fetchMerchantPaymentMethods(publicKey)
  const available = enabled ? wanted.filter((m) => enabled.includes(m)) : wanted

  if (enabled && available.length === 0) {
    console.error(
      `[wompi] Ninguno de los métodos de "${method}" (${wanted.join(', ')}) está habilitado ` +
        `en el comercio (habilitados: ${enabled.join(', ')}). Se mostrarán todos los disponibles.`,
    )
  }

  // Solo se filtra si el checkout respeta todos los códigos pedidos.
  const canFilter =
    available.length > 0 && available.every((m) => FILTERABLE_METHODS.includes(m))

  return {
    publicKey,
    currency: CURRENCY,
    amountInCents: AMOUNT_IN_CENTS,
    reference,
    signature: buildIntegritySignature(reference, AMOUNT_IN_CENTS, CURRENCY, integritySecret),
    ...(isPubliclyRoutableOrigin(origin)
      ? { redirectUrl: new URL('/pago/estado', origin).toString() }
      : {}),
    // Lista vacía = no se filtra, así el usuario ve todas las opciones del
    // comercio en lugar de un modal en blanco.
    paymentMethods: canFilter ? available.join(',') : '',
  }
}
