// SCRAPLINE audio: every sound is synthesized with WebAudio — no audio files,
// no network. One shared noise buffer, short envelopes, per-weapon timbre.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let enabled = true;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 1;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  // Short noise burst through a bandpass filter.
  function noise(dur, freq, q, gain, when = 0) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // Short sine tone with an exponential decay.
  function tone(freq, dur, gain, type = 'sine', slideTo = 0, when = 0) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const SHOTS = {
    pistol: { noiseFreq: 2400, noiseDur: 0.09, noiseGain: 0.5, thump: 170, thumpGain: 0.35 },
    smg: { noiseFreq: 3000, noiseDur: 0.07, noiseGain: 0.42, thump: 200, thumpGain: 0.28 },
    rifle: { noiseFreq: 1800, noiseDur: 0.12, noiseGain: 0.6, thump: 130, thumpGain: 0.45 },
    shotgun: { noiseFreq: 1100, noiseDur: 0.2, noiseGain: 0.7, thump: 90, thumpGain: 0.55 },
    sniper: { noiseFreq: 2600, noiseDur: 0.22, noiseGain: 0.65, thump: 110, thumpGain: 0.5 },
  };

  return {
    unlock() { ensure(); },
    setEnabled(v) { enabled = v; },
    // distance 0..1 (0 = point blank, 1 = far): quieter and duller.
    shot(kind, distance = 0) {
      if (!ensure()) return;
      const s = SHOTS[kind] || SHOTS.rifle;
      const att = 1 - Math.min(0.75, distance * 0.6);
      noise(s.noiseDur, s.noiseFreq * (1 - distance * 0.4), 0.8, s.noiseGain * att);
      tone(s.thump, 0.1, s.thumpGain * att, 'sine', 55);
    },
    dryFire() { if (ensure()) tone(1400, 0.03, 0.12, 'square'); },
    reload() {
      if (!ensure()) return;
      tone(900, 0.03, 0.15, 'square');
      tone(600, 0.03, 0.15, 'square', 0, 0.18);
      tone(1100, 0.04, 0.18, 'square', 0, 0.45);
    },
    hit(head) {
      if (!ensure()) return;
      tone(head ? 2400 : 1700, 0.05, 0.2, 'sine');
      if (head) tone(3200, 0.06, 0.15, 'sine', 0, 0.04);
    },
    footstep(run) {
      if (!ensure()) return;
      noise(0.06, run ? 500 : 380, 1.2, run ? 0.12 : 0.08);
    },
    plantBeep(final) {
      if (!ensure()) return;
      tone(final ? 1800 : 1200, final ? 0.25 : 0.08, 0.2, 'square');
    },
    defuseBeep() { if (ensure()) tone(1500, 0.08, 0.18, 'square'); },
    explosion() {
      if (!ensure()) return;
      noise(1.4, 220, 0.5, 0.9);
      tone(70, 1.1, 0.8, 'sine', 28);
      noise(0.5, 900, 0.7, 0.4, 0.05);
    },
    grenadeBounce() { if (ensure()) tone(320, 0.05, 0.15, 'sine', 180); },
    horn() {
      if (!ensure()) return;
      tone(220, 0.5, 0.25, 'sawtooth', 330);
      tone(330, 0.5, 0.2, 'sawtooth', 440, 0.02);
    },
    roundWin() {
      if (!ensure()) return;
      [523, 659, 784].forEach((f, i) => tone(f, 0.22, 0.22, 'triangle', 0, i * 0.12));
    },
    roundLose() {
      if (!ensure()) return;
      [392, 330, 262].forEach((f, i) => tone(f, 0.25, 0.22, 'triangle', 0, i * 0.14));
    },
    buy() {
      if (!ensure()) return;
      tone(1320, 0.07, 0.18, 'sine');
      tone(1760, 0.1, 0.18, 'sine', 0, 0.07);
    },
    denied() { if (ensure()) tone(220, 0.12, 0.2, 'square', 160); },
    kill() {
      if (!ensure()) return;
      tone(880, 0.06, 0.15, 'sine');
      tone(1174, 0.08, 0.15, 'sine', 0, 0.05);
    },
  };
}
