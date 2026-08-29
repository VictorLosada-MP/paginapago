import { NextResponse } from 'next/server'

import { createInvoice } from '@/lib/nowpayments'
import { PRICE_IN_USD_CENTS, generateReference, isPubliclyRoutableOrigin } from '@/lib/wompi'

/**
 * Crea la factura de cripto y devuelve la URL del checkout de NOWPayments.
 * La clave de API se queda aquí, en el servidor.
 */

export const dynamic = 'force-dynamic'

function resolveOrigin(request: Request): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    request.headers.get('origin') ||
    new URL(request.url).origin
  )
}

export async function POST(request: Request) {
  const origin = resolveOrigin(request)
  const reference = generateReference()

  // El webhook y las URLs de retorno tienen que ser alcanzables desde
  // internet: en local NOWPayments no puede llamarnos de vuelta.
  const isPublic = isPubliclyRoutableOrigin(origin)

  try {
    const invoice = await createInvoice({
      // NOWPayments cobra en USD: aquí no hay conversión a pesos.
      priceAmount: PRICE_IN_USD_CENTS / 100,
      orderId: reference,
      orderDescription: 'Sistema a medida, herramientas y capacitación',
      ...(isPublic
        ? {
            ipnCallbackUrl: new URL('/api/crypto/ipn', origin).toString(),
            successUrl: new URL('/pago/estado?proveedor=crypto', origin).toString(),
            cancelUrl: new URL('/', origin).toString(),
          }
        : {}),
    })

    if (!isPublic) {
      console.warn(
        '[nowpayments] Origen local: la factura se creó sin webhook ni URLs de retorno. ' +
          'Para probar el flujo completo hace falta una URL pública.',
      )
    }

    return NextResponse.json({ invoiceUrl: invoice.invoice_url, reference })
  } catch (error) {
    console.error('[nowpayments] No se pudo crear la factura:', error)
    return NextResponse.json(
      { error: 'No se pudo iniciar el pago en cripto. Inténtalo de nuevo en un momento.' },
      { status: 500 },
    )
  }
}
