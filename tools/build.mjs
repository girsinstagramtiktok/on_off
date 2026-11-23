import fs from 'node:fs';
import path from 'node:path';
const web = path.resolve('web');
const out = path.resolve('www');
fs.rmSync(out, { recursive:true, force:true });
fs.cpSync(web, out, { recursive:true });
const wasm = path.join(web, 'model/edge-impulse-standalone.wasm');
const js = path.join(web, 'model/edge-impulse-standalone.js');
if (!fs.existsSync(wasm) || !fs.existsSync(js)) {
  console.warn('\n⚠ MODELO NO INSTALADO: copia ambos archivos WebAssembly en web/model/ antes de publicar o compilar el APK.\n');
} else {
  console.log('✓ Modelo WebAssembly incluido en www/model/');
}
console.log('✓ Archivos web preparados en www/');
