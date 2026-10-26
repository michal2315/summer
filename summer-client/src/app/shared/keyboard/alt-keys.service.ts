import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { ALT_KEYS, AltKeyId, comboOf } from './alt-keys';

export interface AltHint {
  key: string;
  top: number;
  left: number;
}

/** How long Alt must be held alone before the key badges appear (a quick Alt+key shouldn't flash them). */
const HINT_DELAY_MS = 350;

const isVisible = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return el.isConnected && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden';
};
const isField = (el: HTMLElement) => el.matches('input, textarea, select, [contenteditable="true"]');

/**
 * The Alt keyboard layer: Alt+key activates the element bound to that key (see AltKeyDirective),
 * holding Alt alone shows each bound element's key, Alt+/ toggles the list of every shortcut.
 */
@Injectable({ providedIn: 'root' })
export class AltKeysService {
  private readonly document = inject(DOCUMENT);
  /** Insertion-ordered, so the most recently rendered element wins when two share a key (e.g. a modal over a page). */
  private readonly bound = new Map<HTMLElement, AltKeyId>();
  private hintTimer = 0;

  readonly hints = signal<AltHint[] | null>(null);
  readonly helpOpen = signal(false);

  constructor() {
    const win = this.document.defaultView!;
    win.addEventListener('keydown', (e) => this.onKeyDown(e), true);
    win.addEventListener('keyup', (e) => {
      if (e.key !== 'Alt') return;
      // A lone Alt release would otherwise move focus to the browser's menu button (Windows).
      e.preventDefault();
      this.hideHints();
    });
    win.addEventListener('blur', () => this.hideHints());
    win.addEventListener('scroll', () => this.hideHints(), true);
  }

  register(el: HTMLElement, id: AltKeyId): () => void {
    this.bound.set(el, id);
    return () => this.bound.delete(el);
  }

  toggleHelp(open = !this.helpOpen()) {
    this.hideHints();
    this.helpOpen.set(open);
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Alt') {
      if (!e.repeat) {
        clearTimeout(this.hintTimer);
        this.hintTimer = window.setTimeout(() => this.showHints(), HINT_DELAY_MS);
      }
      return;
    }
    this.hideHints();
    // Ctrl+Alt is AltGr on many layouts: it types characters, it is not a command.
    if (!e.altKey || e.ctrlKey || e.metaKey) {
      if (e.key === 'Escape' && this.helpOpen()) this.helpOpen.set(false);
      return;
    }
    const combo = comboOf(e);
    if (!combo) return;
    if (combo === ALT_KEYS.help.key) {
      e.preventDefault();
      this.toggleHelp();
      return;
    }
    const el = this.target(combo);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    this.helpOpen.set(false);
    if (isField(el)) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    } else {
      el.click();
    }
  }

  /** The element bound to `combo`: the latest visible one, else the latest at all (e.g. a link in the collapsed side nav). */
  private target(combo: string): HTMLElement | undefined {
    const matches = [...this.bound].filter(([, id]) => ALT_KEYS[id].key === combo).map(([el]) => el);
    return matches.filter(isVisible).at(-1) ?? matches.at(-1);
  }

  private showHints() {
    if (this.helpOpen()) return;
    const seen = new Set<string>();
    const hints: AltHint[] = [];
    for (const [el, id] of [...this.bound].reverse()) {
      const key = ALT_KEYS[id].key;
      if (seen.has(key) || !isVisible(el)) continue;
      seen.add(key);
      const r = el.getBoundingClientRect();
      // The element's top inline-start corner (right, in this RTL app).
      hints.push({ key: key.replace('Shift+', '⇧'), top: Math.max(2, r.top - 8), left: Math.min(innerWidth - 24, r.right - 10) });
    }
    this.hints.set(hints);
  }

  private hideHints() {
    clearTimeout(this.hintTimer);
    if (this.hints()) this.hints.set(null);
  }
}
