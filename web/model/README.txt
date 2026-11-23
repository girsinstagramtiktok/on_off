COLOCA AQUI LOS DOS ARCHIVOS DEL ZIP WEBASSEMBLY DE EDGE IMPULSE:

  edge-impulse-standalone.js
  edge-impulse-standalone.wasm

No cambies los nombres. No se incluyen en este proyecto porque son propios de tu
modelo entrenado. Se necesitan ambos archivos para reconocer ON y OFF.

ATENCION: el paquete debe ser "WebAssembly (browser)", no una exportacion Node.js.

La app convierte el microfono a 16 kHz y le pasa al modelo senal PCM 16-bit
convertida a floats con valores +/-32768, no caracteristicas MFCC precalculadas.
El paquete WebAssembly de Edge Impulse extrae MFCC y clasifica internamente.
