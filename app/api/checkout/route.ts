import { NextResponse } from 'next/server'

import { AMOUNT_IN_CENTS, createCheckoutSession } from '@/lib/wompi'

/**
 * Ruta de backend del checkout.
 *
 * Recibe (opcionalmente) el monto que el frontend cree que va a cobrar y
 * devuelve los datos con los que se renderiza el Widget de Wompi:
 * referencia única, firma de integridad y monto.
 *
 * La llave privada y el secreto de integridad se quedan aquí, en el servidor.
 */

// La referencia debe ser distinta en cada visita: nunca cachear la respuesta.
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // El monto que llega del cliente es solo informativo: el servidor firma
  // SIEMPRE su propio monto para que nadie pueda pagar un precio distinto
  // manipulando la petición desde el navegador.
  let requestedAmountInCents: unknown
  try {
    const body = await request.json()
    requestedAmountInCents = (body as { amountInCents?: unknown })?.amountInCents
  } catch {
    // Cuerpo vacío o no-JSON: se usa el monto configurado en el servidor.
  }

  if (requestedAmountInCents !== undefined && requestedAmountInCents !== AMOUNT_IN_CENTS) {
    return NextResponse.json(
      { error: 'El monto solicitado no corresponde al valor de la oferta.' },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json(createCheckoutSession())
  } catch (error) {
    console.error('[wompi] No se pudo generar la sesión de checkout:', error)
    return NextResponse.json(
      { error: 'No se pudo iniciar el pago. Inténtalo de nuevo en un momento.' },
      { status: 500 },
    )
  }
}
