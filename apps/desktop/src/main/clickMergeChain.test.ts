import { describe, expect, it } from 'vitest'
import { detectClicks } from './clickDetect'

const RATE = 44100

// Seno limpio como lecho: es el mismo lecho con el que el detector está calibrado
// (ver la cabecera de clickDetect.ts, "synthetic 2- and 9-sample clicks over sine
// count exactly").
function sine(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE)
  return out
}

function impulseAt(buf: Float32Array, sec: number, amp = 0.9): void {
  buf[Math.round(sec * RATE)] += amp
}

describe('la ventana de fusión de clicks', () => {
  // El comentario del módulo declara el contrato: "Merge detections closer than
  // 5 ms: one physical click, one count". MIN_GAP_SEC es 0.005.
  //
  // Pero `last = i` se rearma en CADA cruce del umbral, incluido el que acaba de
  // ser absorbido por la ventana ("same click, extend it silently"). Así, una
  // cadena de impulsos separados 4 ms entre sí — cada uno por debajo de los 5 ms
  // del anterior, pero repartidos a lo largo de mucho más de 5 ms — se cuenta como
  // UNO solo, porque la ventana se va desplazando indefinidamente hacia delante.
  //
  // Lo que ve el DJ: un vinilo ripeado con una ráfaga de crujidos seguidos (el
  // caso típico de un rip con polvo) le sale como "1 click" en el editor, y la
  // sección de reparación le dice que su pista está prácticamente limpia. Peor:
  // la lista de posiciones sólo trae una marca, así que "saltar al siguiente
  // click" no le lleva a ninguno de los otros.
  it('no encadena una ráfaga de impulsos separados en una sola cuenta', () => {
    const buf = sine(3)
    // 10 impulsos cada 4 ms: la ráfaga entera abarca 36 ms, siete veces la ventana
    // de fusión de 5 ms. Ningún par consecutivo dista más de 5 ms.
    const total = 10
    for (let k = 0; k < total; k++) impulseAt(buf, 1 + k * 0.004)

    const at = detectClicks(buf, RATE)

    // Fusionar por ventana desde el ÚLTIMO contado daría un click cada 5 ms, o sea
    // unos 8 de los 10. Lo que no puede dar es 1: eso significa que la ventana se
    // arrastra con cada cruce en vez de anclarse en la detección contada.
    expect(
      at.length,
      `la ráfaga de ${total} impulsos en 36 ms se contó como ${at.length}`,
    ).toBeGreaterThan(1)
  })

  // NOTA: la otra mitad de la hipótesis — que un cruce RECHAZADO por la aislación
  // (un transitorio musical) rearme la ventana y se coma el click que viene detrás —
  // NO se reprodujo. Con un ataque exponencial de 200 muestras a 3 ms del click, la
  // cuenta sale igual que con el click solo. Se deja constancia para no volver a
  // conjeturarlo: el rearmado sólo hace daño demostrablemente en la cadena de arriba.
  //
  // MEDIDO SOBRE AUDIO REAL (25 pistas del NAS, antes y después de la corrección, desde
  // el mismo PCM decodificado): 19 no cambian y 6 suben. Los dos casos fuertes:
  //
  //   Poky Musica   83 -> 197   (58 de las 114 nuevas a menos de 20 ms de una vieja:
  //                              ráfagas que la regla antigua colapsaba. Ojo, esta
  //                              pista tiene pico 1.37, o sea recorte duro)
  //   Happy groove  10 ->  46   (sólo 4 de 36 dentro de 20 ms, mediana 118 ms)
  //
  // Ese segundo caso es el que amplía el hallazgo: no eran sólo ráfagas juntas. La
  // cadena de supresión más larga en esa pista dura 0,14 s, veintiocho veces la
  // ventana de 5 ms que el comentario del módulo declara, así que la regla vieja iba
  // tragando clicks separados a lo largo de toda la pista, no sólo dentro de un
  // crujido. La cuenta sólo puede subir con este cambio, nunca bajar.
})
