import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type Flash = 'summer' | 'tavor' | 'tomer' | 'coral';

/** Search words → the overlay they trigger, and how long it stays (ms; matches each overlay's $duration). */
const FLASHES: Record<Flash, { words: string[]; ms: number }> = {
  summer: { words: ['summer', 'סאמר'], ms: 2400 },
  tavor: { words: ['tavor', 'תבור'], ms: 3400 },
  tomer: { words: ['tomer', 'תומר'], ms: 3200 },
  coral: { words: ['coral', 'קורל'], ms: 4000 },
};

/** Shown in the browser tab while the user is on another tab. One is picked per visit away. */
const AWAY_TITLES = ['חוזרים? יש עוד מה לסכם 👀', 'התמציות מתגעגעות ☀️', 'רק עוד תמצית אחת… 📝', 'Summer מחכה לך 🌴'];

/** Small surprises: search words that trigger overlays, and the away-tab title. Mounted once, from the app root. */
@Injectable({ providedIn: 'root' })
export class EasterEggsService {
  private readonly document = inject(DOCUMENT);
  private titleBeforeAway: string | null = null;

  /** The overlay showing right now, if any. */
  readonly flash = signal<Flash | null>(null);

  /** Called with every submitted search; the search itself still runs as usual. */
  onSearch(text: string | undefined): void {
    const word = text?.trim().toLowerCase();
    if (!word) return;
    const match = (Object.keys(FLASHES) as Flash[]).find((f) => FLASHES[f].words.includes(word));
    if (match) this.show(match);
  }

  show(flash: Flash): void {
    if (this.flash()) return;
    this.flash.set(flash);
    setTimeout(() => this.flash.set(null), FLASHES[flash].ms);
  }

  /** Swap the tab title while the page is hidden and put it back on return — unless the router changed it meanwhile. */
  watchTabTitle(): void {
    let awayTitle = '';
    this.document.addEventListener('visibilitychange', () => {
      if (this.document.hidden) {
        this.titleBeforeAway = this.document.title;
        awayTitle = AWAY_TITLES[Math.floor(Math.random() * AWAY_TITLES.length)];
        this.document.title = awayTitle;
      } else if (this.titleBeforeAway !== null) {
        if (this.document.title === awayTitle) this.document.title = this.titleBeforeAway;
        this.titleBeforeAway = null;
      }
    });
  }
}
