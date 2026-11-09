import { Injectable, signal } from '@angular/core';

const PREFS_KEY = 'bp_speech_prefs';

interface SpeechPrefs {
  voiceURI: string | null;
  rate: number;
  autoRead: boolean;
}

/** Reads text aloud using the browser's built-in speech synthesis. */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  /** Id of the message currently being read, or null. */
  speakingId = signal<string | null>(null);
  paused = signal(false);
  voices = signal<SpeechSynthesisVoice[]>([]);

  voiceURI = signal<string | null>(null);
  rate = signal(1);
  autoRead = signal(true);

  constructor() {
    if (!this.supported) return;
    this.loadPrefs();
    const refresh = () => this.voices.set(speechSynthesis.getVoices());
    refresh();
    speechSynthesis.addEventListener('voiceschanged', refresh);
  }

  speak(id: string, markdown: string) {
    if (!this.supported) return;
    this.stop();
    const chunks = this.chunk(this.toPlainText(markdown));
    if (!chunks.length) return;
    const voice = this.voices().find(v => v.voiceURI === this.voiceURI()) ?? null;
    this.speakingId.set(id);
    chunks.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = this.rate();
      if (voice) { u.voice = voice; u.lang = voice.lang; }
      if (i === chunks.length - 1) {
        u.onend = () => { if (this.speakingId() === id) this.reset(); };
      }
      u.onerror = () => { if (this.speakingId() === id) this.reset(); };
      speechSynthesis.speak(u);
    });
  }

  togglePause() {
    if (!this.speakingId()) return;
    if (this.paused()) { speechSynthesis.resume(); this.paused.set(false); }
    else { speechSynthesis.pause(); this.paused.set(true); }
  }

  stop() {
    if (!this.supported) return;
    speechSynthesis.cancel();
    this.reset();
  }

  setVoice(uri: string | null) { this.voiceURI.set(uri); this.savePrefs(); }
  setRate(rate: number) { this.rate.set(rate); this.savePrefs(); }
  setAutoRead(on: boolean) { this.autoRead.set(on); this.savePrefs(); }

  private reset() {
    this.speakingId.set(null);
    this.paused.set(false);
  }

  /** Strips markdown so the voice doesn't read out symbols. */
  private toPlainText(md: string): string {
    return md
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\|/g, ', ')
      .replace(/^[\s,:-]+$/gm, '')
      .replace(/(\*\*|__|\*|_|~~)/g, '')
      .replace(/\n{2,}/g, '.\n')
      .replace(/\.{2,}/g, '.')
      .trim();
  }

  /** Chrome stops long utterances after ~15s, so speak in sentence-sized chunks. */
  private chunk(text: string, max = 220): string[] {
    const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) ?? [text];
    const out: string[] = [];
    let cur = '';
    for (const s of sentences) {
      if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
      cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  private loadPrefs() {
    try {
      const p: Partial<SpeechPrefs> = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
      if (p.voiceURI !== undefined) this.voiceURI.set(p.voiceURI);
      if (typeof p.rate === 'number') this.rate.set(p.rate);
      if (typeof p.autoRead === 'boolean') this.autoRead.set(p.autoRead);
    } catch { /* ignore */ }
  }

  private savePrefs() {
    try {
      const p: SpeechPrefs = { voiceURI: this.voiceURI(), rate: this.rate(), autoRead: this.autoRead() };
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch { /* ignore */ }
  }
}
