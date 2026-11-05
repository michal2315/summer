import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, HostListener, effect, inject, signal } from '@angular/core';
import { EasterEggsService } from '../easter-eggs.service';

interface Sparkle {
  id: number;
  x: number;
  y: number;
  /** drift while fading, px */
  dx: number;
  dy: number;
  /** a heart instead of a dot */
  heart: boolean;
  color: string;
  size: number;
}

const PINKS = ['#ff4f9a', '#ff85c0', '#ffb3d9', '#e8257d', '#ff69b4'];
/** Min gap between sparkles, ms, and how many can be on screen at once. */
const SPAWN_GAP = 24;
const MAX_SPARKLES = 60;

/**
 * The "coral" search easter egg, for our other product manager (a very pink person): for a few seconds the brand bits
 * go hot pink (`html.coral-mode` in styles.scss), and the cursor leaves a trail of pink sparkles and hearts.
 */
@Component({
  selector: 'app-coral-flash',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coral-flash.component.html',
  styleUrl: './coral-flash.component.scss',
})
export class CoralFlashComponent {
  readonly eggs = inject(EasterEggsService);
  readonly sparkles = signal<Sparkle[]>([]);
  private nextId = 0;
  private lastSpawn = 0;

  constructor() {
    const root = inject(DOCUMENT).documentElement;
    effect(() => root.classList.toggle('coral-mode', this.eggs.flash() === 'coral'));
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(e: PointerEvent): void {
    if (this.eggs.flash() !== 'coral' || e.timeStamp - this.lastSpawn < SPAWN_GAP) return;
    this.lastSpawn = e.timeStamp;
    const sparkle: Sparkle = {
      id: this.nextId++,
      x: e.clientX,
      y: e.clientY,
      dx: (Math.random() - 0.5) * 40,
      dy: 10 + Math.random() * 30,
      heart: Math.random() < 0.3,
      color: PINKS[Math.floor(Math.random() * PINKS.length)],
      size: 6 + Math.random() * 8,
    };
    this.sparkles.update((list) => [...list.slice(-(MAX_SPARKLES - 1)), sparkle]);
  }

  remove(id: number): void {
    this.sparkles.update((list) => list.filter((s) => s.id !== id));
  }
}
