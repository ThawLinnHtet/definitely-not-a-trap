export type TrapSound = 'rock-warning' | 'rock-impact' | 'spikes-rise' | 'bridge-snap' | 'death';

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(context: BaseAudioContext) {
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * .3), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<data.length;i++) data[i] = Math.random()*2-1;
    noiseBuffers.set(context, buffer);
  }
  return buffer;
}

export function playTrapSound(context: BaseAudioContext, cue: TrapSound) {
  const now = context.currentTime;

  function envelope(source: AudioNode, at: number, duration: number, volume: number) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(.001,at);
    gain.gain.linearRampToValueAtTime(volume,at+.003);
    gain.gain.exponentialRampToValueAtTime(.001,at+duration);
    source.connect(gain).connect(context.destination);
  }

  function tone(type: OscillatorType, from: number, to: number, duration: number, volume: number, delay=0) {
    const at = now+delay;
    const source = context.createOscillator();
    source.type = type;
    source.frequency.setValueAtTime(from,at);
    source.frequency.exponentialRampToValueAtTime(to,at+duration);
    envelope(source,at,duration,volume);
    source.start(at);
    source.stop(at+duration);
  }

  function noise(frequency: number, duration: number, volume: number, delay=0) {
    const at = now+delay;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    source.buffer = noiseBuffer(context);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency,at);
    filter.Q.value = .8;
    source.connect(filter);
    envelope(filter,at,duration,volume);
    source.start(at,Math.random()*(source.buffer.duration-duration));
    source.stop(at+duration);
  }

  switch (cue) {
    case 'rock-warning':
      tone('triangle',122,78,.16,.105);
      noise(290,.15,.13);
      break;
    case 'rock-impact':
      tone('sine',118,48,.22,.18);
      tone('triangle',235,112,.075,.075);
      noise(620,.19,.21);
      break;
    case 'spikes-rise':
      tone('triangle',1460,930,.075,.075);
      tone('sine',2060,1530,.05,.045,.014);
      noise(2850,.065,.15);
      break;
    case 'bridge-snap':
      noise(1520,.075,.23);
      tone('triangle',315,114,.13,.085);
      noise(730,.115,.12,.036);
      break;
    case 'death':
      tone('triangle',392,347,.085,.08);
      tone('triangle',294,248,.09,.07,.068);
      tone('triangle',196,124,.145,.075,.14);
      break;
  }
}
