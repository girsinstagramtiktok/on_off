// Captura PCM sin compresión para la inferencia local.
class LumaRecorder extends AudioWorkletProcessor {
  constructor(){super();this.samples=new Float32Array(2048);this.position=0;}
  process(inputs){
    const audio=inputs[0]?.[0];
    if(!audio)return true;
    for(let i=0;i<audio.length;i++){
      this.samples[this.position++]=audio[i];
      if(this.position===this.samples.length){this.port.postMessage(this.samples);this.samples=new Float32Array(2048);this.position=0;}
    }
    return true;
  }
}
registerProcessor('luma-recorder',LumaRecorder);
