# Luma · control de luz por voz

Aplicación web móvil con estética menta/bento, preparada para funcionar con el **modelo real de Edge Impulse** y exportarse como **APK Android** mediante GitHub Actions + Capacitor.

## Qué hace

- Muestra una **bombilla virtual** grande, animada, que se enciende al reconocer **ON** y se apaga al reconocer **OFF**.
- Botón **Activar escucha / Detener escucha**, que solicita autorización del micrófono.
- Clasificación continua del audio local mediante la exportación **WebAssembly (browser)** de Edge Impulse.
- Muestra la última etiqueta y su probabilidad; las etiquetas **UNKNOWN** y predicciones poco confiables no cambian la luz.
- Un umbral de confianza ajustable (85 % inicialmente), una diferencia mínima frente a la segunda etiqueta y dos detecciones coherentes antes de cambiar el estado reducen falsas activaciones. Se aplica un intervalo de seguridad de 1,8 s tras cada cambio.
- El modelo y las señales **no se envían a ningún servidor**: el reconocimiento se ejecuta en el dispositivo. La app reproduce **una bombilla en pantalla**; no activa un circuito eléctrico físico.

## PASO 1 — incorporar tu exportación WebAssembly

En Edge Impulse, entra en **Deployment → WebAssembly (browser) → Build** y descarga el ZIP correspondiente al clasificador entrenado con tres etiquetas `on`, `off`, `unknown` y entrada a 16 kHz.

Extrae estos dos archivos del ZIP:

```
edge-impulse-standalone.js
edge-impulse-standalone.wasm
```

Colócalos en:

```
web/model/edge-impulse-standalone.js
web/model/edge-impulse-standalone.wasm
```

**Estos dos archivos NO vienen incluidos aquí.** La aplicación muestra un error claro si faltan; nunca inventa probabilidades ni simula que ha detectado voz. Después de añadirlos hay que publicar o compilar de nuevo.

Los archivos del modelo deben tener esos nombres exactos, y la variante exportada debe ser **WebAssembly (browser)**, no WebAssembly para Node.js. Si la exportación usa otra interfaz de JavaScript, puede necesitarse ajustar el adaptador `web/edge-impulse.js`; hay que comprobarlo con el ZIP real.

## PASO 2 — probar la web

Desde la carpeta raíz del proyecto, con Python instalado:

```bash
python -m http.server 8000 --directory web
```

Abre <http://localhost:8000> en la computadora. Para probar en un teléfono, usa el enlace **HTTPS** de GitHub Pages, no una dirección HTTP de tu red doméstica; de lo contrario, muchos navegadores impedirán el acceso al micrófono.

El micrófono se procesa a **16 kHz** (remuestreo lineal desde la frecuencia real del dispositivo) con ventanas de 1 segundo, o el número exacto de muestras comunicado por el modelo. Se leen ventanas solapadas cada 460 ms. Los datos se entregan como muestras PCM16 numéricas flotantes al paquete Edge Impulse, que realiza el preprocesamiento MFCC y la clasificación.

## PASO 3 — subir a GitHub

1. Crea un repositorio GitHub nuevo, por ejemplo `luma-voice`.
2. Sube el **contenido completo** de este ZIP, incluidas las carpetas `.github/` y `web/model/` con los dos archivos WASM exportados.
3. Usa la rama `main`.
4. En GitHub → **Settings → Pages → Build and deployment**, selecciona **GitHub Actions**.
5. En **Actions**, ejecuta **Publicar web en GitHub Pages** (o deja que se ejecute automáticamente tras un push a `main`). La web resultante debe abrirse por **HTTPS**.

> Ten en cuenta que los repositorios públicos y GitHub Pages hacen que el binario del modelo quede disponible públicamente. Evita publicarlo si tu licencia o requisitos de privacidad lo prohíben.

## PASO 4 — compilar APK en GitHub

1. Cuando los archivos `.wasm` y `.js` ya estén en `web/model/`, entra en el repositorio de GitHub → pestaña **Actions**.
2. Abre el flujo **Compilar APK Android** y pulsa **Run workflow**.
3. Cuando la ejecución finalice, descarga el artefacto **`luma-debug-apk`** (ZIP generado por Actions).
4. Dentro encontrarás `app-debug.apk`, para instalarlo manualmente en Android, autorizando la instalación desde esa fuente si se solicita.

Se trata de un **APK de depuración**, válido para pruebas. Para distribuir en Play Store hace falta compilar y firmar una versión de lanzamiento (`release`) con tu propia clave de firma.

### Compilar APK localmente (opcional)

Requisitos: Node.js, Android SDK y JDK.

```bash
npm install
npm run build
npx cap add android
```

Añade estos permisos al archivo `android/app/src/main/AndroidManifest.xml`, como hijos directos de `<manifest>`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

Después:

```bash
npx cap sync android
cd android
./gradlew assembleDebug
```

En Windows, ejecuta `gradlew.bat assembleDebug` en lugar de `./gradlew`.

El APK aparece en `android/app/build/outputs/apk/debug/app-debug.apk`.

## Notas técnicas y limitaciones

- La captura usa **AudioWorklet** cuando está disponible y el procesador de audio estándar como respaldo para navegadores WebView con compatibilidad limitada.
- Android necesita el permiso `RECORD_AUDIO`; el workflow lo añade al AndroidManifest. Capacitor gestiona la solicitud de permiso desde WebView en las versiones compatibles.
- En Android, mantén la aplicación **abierta y en primer plano** mientras escucha. No se ha implementado escucha persistente en segundo plano.
- Los valores de confianza son los del modelo y pueden variar con el ruido, el micrófono y la pronunciación. El umbral no garantiza que nunca se active por error.
- Sin el ZIP exacto de Edge Impulse no es posible comprobar todavía la compatibilidad de la versión exportada ni el comportamiento real del modelo en un teléfono. La interfaz y el código son una integración preparada, no una prueba experimental validada.
- La demo sólo controla la luz **virtual**. Para activar una lámpara física se necesita hardware y un canal de control adicionales.
