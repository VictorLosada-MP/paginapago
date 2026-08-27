import { NextResponse } from 'next/server'

import { AMOUNT_IN_CENTS, createCheckoutSession, isPaymentMethodId } from '@/lib/wompi'

/**
 * Ruta de backend del checkout.
 *
 * Recibe el método de pago elegido y (opcionalmente) el monto que el frontend
 * cree que va a cobrar, y devuelve los datos con los que se abre el Widget de
 * Wompi: referencia única, firma de integridad y monto.
 *
 * La llave privada y el secreto de integridad se quedan aquí, en el servidor.
 */

// La referencia debe ser distinta en cada intento: nunca cachear la respuesta.
export const dynamic = 'force-dynamic'

/**
 * Origen absoluto del sitio, para armar la URL de retorno de Wompi.
 * Se prefiere la variable de entorno; si no está, se usa el origen de la
 * petición del propio navegador.
 */
function resolveOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured

  const originHeader = request.headers.get('origin')
  if (originHeader) return originHeader

  return new URL(request.url).origin
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    // Cuerpo vacío o no-JSON: se usan los valores por defecto.
  }

  const method = body.method ?? 'card'
  if (!isPaymentMethodId(method)) {
    return NextResponse.json({ error: 'Método de pago no válido.' }, { status: 400 })
  }

  // El monto que llega del cliente es solo informativo: el servidor firma
  // SIEMPRE su propio monto para que nadie pueda pagar un precio distinto
  // manipulando la petición desde el navegador.
  if (body.amountInCents !== undefined && body.amountInCents !== AMOUNT_IN_CENTS) {
    return NextResponse.json(
      { error: 'El monto solicitado no corresponde al valor de la oferta.' },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(createCheckoutSession(method, resolveOrigin(request)))
  } catch (error) {
    console.error('[wompi] No se pudo generar la sesión de checkout:', error)
    return NextResponse.json(
      { error: 'No se pudo iniciar el pago. Inténtalo de nuevo en un momento.' },
      { status: 500 },
    )
  }
}
