import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Cliente de NOWPayments (pagos en cripto).
 *
 * Uso EXCLUSIVO en el servidor: lee `NOWPAYMENTS_API_KEY` y
 * `NOWPAYMENTS_IPN_SECRET`, que nunca deben llegar al navegador.
 *
 * A diferencia de Wompi, aquí el cobro se hace en USD directo, así que no hay
 * conversión a pesos ni tasa de cambio que mantener.
 */

const API_URL = process.env.NOWPAYMENTS_API_URL ?? 'https://api.nowpayments.io/v1'

/** El botón de cripto solo se ofrece si la pasarela está configurada. */
export const CRYPTO_ENABLED = Boolean(process.env.NOWPAYMENTS_API_KEY)

/**
 * Estados que reporta NOWPayments.
 *
 * Solo `finished` significa cobrado. `confirming` y `confirmed` son pasos
 * intermedios de la red: el dinero todavía puede no estar disponible, así que
 * no se debe entregar nada hasta `finished`.
 */
export type PaymentStatus =
  | 'waiting'
  | 'confirming'
  | 'confirmed'
  | 'sending'
  | 'partially_paid'
  | 'finished'
  | 'failed'
  | 'refunded'
  | 'expired'

export type Invoice = {
  id: string
  invoice_url: string
  order_id?: string
}

export type IpnPayload = {
  payment_id?: number | string
  payment_status?: PaymentStatus
  order_id?: string
  price_amount?: number
  price_currency?: string
  actually_paid?: number
  pay_currency?: string
}

function requireApiKey(): string {
  const key = process.env.NOWPAYMENTS_API_KEY
  if (!key) throw new Error('Falta la variable de entorno NOWPAYMENTS_API_KEY')
  return key
}

/**
 * Crea una factura (checkout alojado por NOWPayments) y devuelve la URL a la
 * que hay que mandar al comprador.
 *
 * Se usa la factura y no la API de pagos directa a propósito: NOWPayments se
 * encarga de mostrar la dirección, el QR, el temporizador y los pagos
 * incompletos. Montar eso a mano es mucha superficie para equivocarse con
 * dinero de por medio.
 */
export async function createInvoice(params: {
  priceAmount: number
  orderId: string
  orderDescription: string
  ipnCallbackUrl?: string
  successUrl?: string
  cancelUrl?: string
}): Promise<Invoice> {
  const response = await fetch(`${API_URL}/invoice`, {
    method: 'POST',
    headers: {
      'x-api-key': requireApiKey(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      price_amount: params.priceAmount,
      price_currency: 'usd',
      order_id: params.orderId,
      order_description: params.orderDescription,
      // Fija la tasa al crear la factura: sin esto, una caída del mercado
      // mientras el comprador paga se la come el vendedor.
      is_fixed_rate: true,
      // La comisión de red la paga quien compra, para recibir el monto íntegro.
      is_fee_paid_by_user: true,
      ...(params.ipnCallbackUrl ? { ipn_callback_url: params.ipnCallbackUrl } : {}),
      ...(params.successUrl ? { success_url: params.successUrl } : {}),
      ...(params.cancelUrl ? { cancel_url: params.cancelUrl } : {}),
    }),
    cache: 'no-store',
  })

  const body = (await response.json()) as Invoice & { message?: string; code?: string }

  if (!response.ok || !body.invoice_url) {
    throw new Error(
      `NOWPayments rechazó la factura (${response.status}): ${body.message ?? body.code ?? 'sin detalle'}`,
    )
  }

  return body
}

/** Consulta el estado real de un pago contra NOWPayments. */
export async function getPaymentStatus(paymentId: string): Promise<PaymentStatus | null> {
  try {
    const response = await fetch(`${API_URL}/payment/${encodeURIComponent(paymentId)}`, {
      headers: { 'x-api-key': requireApiKey() },
      cache: 'no-store',
    })
    if (!response.ok) return null
    const body = (await response.json()) as { payment_status?: PaymentStatus }
    return body.payment_status ?? null
  } catch (error) {
    console.error('[nowpayments] No se pudo consultar el pago:', error)
    return null
  }
}

/**
 * Ordena las claves de un objeto alfabéticamente, de forma recursiva.
 * NOWPayments firma el cuerpo del webhook así antes de serializarlo.
 */
export function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortObjectKeys((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}

/**
 * Verifica la firma del webhook (IPN).
 *
 * NOWPayments manda en la cabecera `x-nowpayments-sig` el HMAC-SHA512 del
 * cuerpo con las claves ordenadas alfabéticamente, usando el secreto IPN.
 *
 * Esta comprobación es la frontera de seguridad de todo el flujo de cripto:
 * el webhook es público, así que sin verificar la firma cualquiera podría
 * mandarnos un "pago aprobado" falso.
 */
export function isValidIpnSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET
  if (!secret || !signature) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return false
  }

  const expected = createHmac('sha512', secret)
    .update(JSON.stringify(sortObjectKeys(parsed)))
    .digest('hex')

  // timingSafeEqual exige la misma longitud; distinta longitud ya es un fallo.
  if (expected.length !== signature.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
