// Adaptador para la exportación WebAssembly (browser) de Edge Impulse.
// No existe un modelo de demostración: sólo se ejecuta el modelo real suministrado.

const BASE = new URL('./model/', import.meta.url);
const MODEL_JS = new URL('edge-impulse-standalone.js', BASE);
const MODEL_WASM = new URL('edge-impulse-standalone.wasm', BASE);

function checkReady(module) {
  return module && typeof module.run_classifier === 'function' &&
    typeof module._malloc === 'function' && typeof module._free === 'function';
}

async function assertFilesPresent() {
  for (const url of [MODEL_JS, MODEL_WASM]) {
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error('Falta el modelo de Edge Impulse. Copia edge-impulse-standalone.js y edge-impulse-standalone.wasm en la carpeta web/model/.');
    }
  }
}

export async function loadEdgeImpulse() {
  await assertFilesPresent();

  let runtimeReady;
  let runtimeFailure;
  const ready = new Promise((resolve, reject) => { runtimeReady = resolve; runtimeFailure = reject; });
  const options = {
    locateFile: file => new URL(file, BASE).href,
    onRuntimeInitialized: () => runtimeReady(window.Module),
    onAbort: reason => runtimeFailure(new Error('Error al cargar WebAssembly: ' + reason))
  };

  // Las exportaciones de Edge Impulse pueden usar Module como objeto o
  // como una función constructora asíncrona de Emscripten.
  window.Module = options;
  const script = document.createElement('script');
  script.src = MODEL_JS.href;
  script.async = true;
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error('No fue posible abrir el archivo JavaScript del modelo.'));
    document.head.appendChild(script);
  });

  let mod = window.Module;
  if (typeof mod === 'function') {
    mod = await mod(options);
  } else if (mod && typeof mod.then === 'function') {
    mod = await mod;
  } else if (!checkReady(mod)) {
    mod = await Promise.race([
      ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('El modelo no terminó de inicializarse. Revisa si el ZIP es WebAssembly (browser).')), 20000))
    ]);
  }
  if (!checkReady(mod)) throw new Error('La exportación no expone run_classifier, _malloc y _free. Selecciona WebAssembly (browser) en Edge Impulse.');

  const properties = typeof mod.get_properties === 'function' ? mod.get_properties() : null;
  const frequency = Math.round(Number(properties?.frequency || 16000));
  const frameSampleCount = Math.round(Number(properties?.frame_sample_count || 16000));
  if (!Number.isFinite(frequency) || !Number.isFinite(frameSampleCount) || frameSampleCount < 256) {
    throw new Error('El modelo informó parámetros de audio inválidos.');
  }
  if (frequency !== 16000) {
    throw new Error(`Este proyecto utiliza audio a 16 kHz, pero el modelo requiere ${frequency} Hz.`);
  }

  return {
    frequency,
    frameSampleCount,
    classify(floatPCM16) {
      if (floatPCM16.length !== frameSampleCount) throw new Error('Tamaño de ventana incorrecto para el modelo.');
      const data = floatPCM16 instanceof Float32Array ? floatPCM16 : Float32Array.from(floatPCM16);
      const ptr = mod._malloc(data.byteLength);
      if (!ptr) throw new Error('Memoria insuficiente dentro del módulo WebAssembly.');
      let result;
      try {
        // HEAPU8.buffer puede cambiar si WebAssembly amplía su memoria.
        new Uint8Array(mod.HEAPU8.buffer, ptr, data.byteLength)
          .set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        result = mod.run_classifier(ptr, data.length, false);
      } finally {
        mod._free(ptr);
      }
      if (!result || result.result !== 0) {
        const code = result ? result.result : 'desconocido';
        result?.delete?.();
        throw new Error('Edge Impulse no pudo clasificar la señal (código ' + code + ').');
      }
      const scores = {};
      const vector = result.classification;
      if (vector && typeof vector.size === 'function') {
        for (let i = 0; i < vector.size(); i++) {
          const item = vector.get(i);
          scores[String(item.label).toLowerCase()] = Number(item.value);
          item.delete?.();
        }
        vector.delete?.();
      } else if (Array.isArray(vector)) {
        for (const item of vector) scores[String(item.label).toLowerCase()] = Number(item.value);
      } else {
        result.delete?.();
        throw new Error('Formato de resultados no reconocido en la exportación.');
      }
      result.delete?.();
      return scores;
    }
  };
}
