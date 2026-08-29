import { NextResponse } from 'next/server'

import { type IpnPayload, isValidIpnSignature } from '@/lib/nowpayments'

/**
 * Webhook de NOWPayments (IPN).
 *
 * Es la ÚNICA fuente de verdad sobre si un pago en cripto se completó: el
 * comprador puede cerrar la pestaña antes de que la red confirme, así que
 * volver a la página no prueba nada.
 *
 * El endpoint es público, de modo que la firma se verifica siempre y se
 * rechaza cualquier cosa que no venga firmada con el secreto IPN. Sin eso,
 * cualquiera podría mandar un "pago aprobado" falso.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // Hay que leer el cuerpo en crudo: la firma se calcula sobre el JSON, no
  // sobre un objeto ya reserializado por el framework.
  const rawBody = await request.text()
  const signature = request.headers.get('x-nowpayments-sig')

  // Se distingue el motivo porque, si no, "firma inválida" despista: lo más
  // común la primera vez es que el secreto no esté configurado todavía.
  if (!process.env.NOWPAYMENTS_IPN_SECRET) {
    console.error(
      '[nowpayments] Llegó un webhook pero NOWPAYMENTS_IPN_SECRET no está definida, ' +
        'así que no se puede verificar y se descarta. Copia el secreto desde ' +
        'NOWPayments → Configuración → Pagos → Notificaciones de pago instantáneas.',
    )
    return NextResponse.json({ error: 'Webhook no configurado' }, { status: 401 })
  }

  if (!isValidIpnSignature(rawBody, signature)) {
    console.warn('[nowpayments] IPN con firma inválida: descartado')
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  }

  let payload: IpnPayload
  try {
    payload = JSON.parse(rawBody) as IpnPayload
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const { order_id: orderId, payment_status: status, payment_id: paymentId } = payload

  // Solo `finished` significa cobrado. `confirming`/`confirmed`/`sending` son
  // pasos intermedios y el dinero todavía puede no estar disponible.
  if (status === 'finished') {
    console.log(`[nowpayments] PAGO COMPLETADO order=${orderId} payment=${paymentId}`)
    // TODO: aquí va la entrega (guardar la venta, notificar). Requiere
    // almacenamiento: hoy el proyecto no tiene base de datos.
  } else {
    console.log(`[nowpayments] estado=${status} order=${orderId} payment=${paymentId}`)
  }

  // NOWPayments reintenta si no recibe 200.
  return NextResponse.json({ received: true })
}
