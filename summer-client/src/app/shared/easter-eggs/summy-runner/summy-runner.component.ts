import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, input, viewChild } from '@angular/core';
import { StorageService } from '../../../core/storage/storage.service';

const HEIGHT = 200;
const GROUND = 170;
const SUMMY_R = 18;
const GRAVITY = 2200; // px/s²
const JUMP = 720; // px/s
const START_SPEED = 320; // px/s
const MAX_SPEED = 820;
const ACCELERATION = 9; // px/s per second
const BEST_KEY = 'summyRunnerBest';

// Canvas can't read SCSS — keep in sync with styles/_tokens.scss.
const C = {
  pink: '#ff4056',
  orange: '#ff9155',
  star: '#fab005',
  text: '#05043d',
  muted: '#8e8ea6',
  border: '#d6d6e0',
  card: '#ffffff',
  line: '#e4e4ec',
};

/** Paragraph blocks to jump over: width × height. */
const OBSTACLES = [
  { w: 26, h: 30 },
  { w: 40, h: 44 },
  { w: 62, h: 30 },
  { w: 30, h: 56 },
];

interface Obstacle {
  x: number;
  w: number;
  h: number;
}

type State = 'ready' | 'running' | 'over';

/**
 * Summy Runner — a dino-style endless runner. Summy jumps over paragraphs coming at it with the reading direction (left → right).
 * Space / ↑ / click / tap to jump. The loop runs outside Angular; everything, score included, is drawn on the canvas.
 */
@Component({
  selector: 'app-summy-runner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    tabindex: '0',
    role: 'application',
    'aria-label': 'Summy Runner — רווח או לחיצה כדי לקפוץ',
    '(keydown)': 'onKey($event)',
    '(pointerdown)': 'jump()',
  },
  templateUrl: './summy-runner.component.html',
  styleUrl: './summy-runner.component.scss',
})
export class SummyRunnerComponent {
  private readonly storage = inject(StorageService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Take keyboard focus on start, so Space works right away (off where the game merely sits on a page). */
  readonly autofocus = input(false);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private ctx!: CanvasRenderingContext2D;
  private width = 600;
  private frame = 0;
  private last = 0;

  private state: State = 'ready';
  private y = 0; // height above the ground
  private vy = 0;
  private speed = START_SPEED;
  private obstacles: Obstacle[] = [];
  private nextSpawn = 0; // seconds
  private elapsed = 0;
  private groundOffset = 0;
  private rayAngle = 0;
  private score = 0;
  private best = this.storage.get<number>(BEST_KEY) ?? 0;

  constructor() {
    const zone = inject(NgZone);
    afterNextRender(() => {
      this.setup();
      if (this.autofocus()) this.host.nativeElement.focus({ preventScroll: true });
      zone.runOutsideAngular(() => {
        this.frame = requestAnimationFrame((t) => this.tick(t));
      });
    });
    const resize = () => this.resize();
    window.addEventListener('resize', resize);
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.frame);
      window.removeEventListener('resize', resize);
    });
  }

  onKey(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.jump();
    }
  }

  jump() {
    if (this.state !== 'running') return this.start();
    if (this.y === 0) this.vy = JUMP;
  }

  private start() {
    this.state = 'running';
    this.obstacles = [];
    this.speed = START_SPEED;
    this.elapsed = 0;
    this.score = 0;
    this.y = 0;
    this.vy = JUMP;
    this.nextSpawn = 0.8;
  }

  private setup() {
    this.ctx = this.canvasRef().nativeElement.getContext('2d')!;
    this.resize();
  }

  private resize() {
    if (!this.ctx) return;
    const canvas = this.canvasRef().nativeElement;
    const dpr = window.devicePixelRatio || 1;
    this.width = canvas.clientWidth;
    canvas.width = this.width * dpr;
    canvas.height = HEIGHT * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private tick(now: number) {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 0;
    this.last = now;
    if (this.state === 'running') this.update(dt);
    this.rayAngle += dt * (this.state === 'running' ? 4 : 0.6);
    this.draw();
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  private update(dt: number) {
    this.elapsed += dt;
    this.speed = Math.min(MAX_SPEED, START_SPEED + this.elapsed * ACCELERATION);
    this.score = Math.floor(this.elapsed * 10);
    this.groundOffset = (this.groundOffset + this.speed * dt) % 24;

    this.vy -= GRAVITY * dt;
    this.y = Math.max(0, this.y + this.vy * dt);
    if (this.y === 0) this.vy = 0;

    for (const o of this.obstacles) o.x += this.speed * dt;
    this.obstacles = this.obstacles.filter((o) => o.x < this.width + 10);

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      const kind = OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)];
      this.obstacles.push({ x: -kind.w, ...kind });
      // Gaps shrink in time but never below what a jump can clear at the current speed.
      const minGap = 0.75 + 120 / this.speed;
      this.nextSpawn = minGap + Math.random() * 0.9;
    }

    if (this.obstacles.some((o) => this.hits(o))) this.gameOver();
  }

  private summyX() {
    return this.width - 70;
  }

  /** Circle-vs-rectangle, a few pixels forgiving. */
  private hits(o: Obstacle): boolean {
    const cx = this.summyX();
    const cy = GROUND - SUMMY_R - this.y;
    const nx = Math.max(o.x, Math.min(cx, o.x + o.w));
    const ny = Math.max(GROUND - o.h, Math.min(cy, GROUND));
    return (cx - nx) ** 2 + (cy - ny) ** 2 < (SUMMY_R - 4) ** 2;
  }

  private gameOver() {
    this.state = 'over';
    if (this.score > this.best) {
      this.best = this.score;
      this.storage.set(BEST_KEY, this.best);
    }
  }

  // ---- drawing ----

  private draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, HEIGHT);

    // Ground: a line with dashes sliding along with the run.
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND + 1);
    ctx.lineTo(this.width, GROUND + 1);
    ctx.stroke();
    ctx.fillStyle = C.line;
    for (let x = this.groundOffset - 24; x < this.width; x += 24) ctx.fillRect(x, GROUND + 8, 10, 2);

    for (const o of this.obstacles) this.drawParagraph(o);
    this.drawSummy();
    this.drawText();
  }

  private drawParagraph(o: Obstacle) {
    const ctx = this.ctx;
    const top = GROUND - o.h;
    ctx.fillStyle = C.card;
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(o.x, top, o.w, o.h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.line;
    for (let ly = top + 7, i = 0; ly < GROUND - 5; ly += 7, i++) {
      const lw = (o.w - 10) * (i % 3 === 2 ? 0.6 : 1);
      ctx.fillRect(o.x + o.w - 5 - lw, ly, lw, 3); // right-aligned lines, like Hebrew text
    }
  }

  private drawSummy() {
    const ctx = this.ctx;
    const cx = this.summyX();
    const cy = GROUND - SUMMY_R - this.y;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = C.star;
    for (let i = 0; i < 10; i++) {
      ctx.save();
      ctx.rotate(this.rayAngle + (i * Math.PI) / 5);
      ctx.beginPath();
      ctx.roundRect(-2, -SUMMY_R - 9, 4, 7, 2);
      ctx.fill();
      ctx.restore();
    }

    const face = ctx.createLinearGradient(-SUMMY_R, -SUMMY_R, SUMMY_R, SUMMY_R);
    face.addColorStop(0, '#ffc94a');
    face.addColorStop(1, C.orange);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(0, 0, SUMMY_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = C.text;
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (this.state === 'over') {
      for (const ex of [-7, 7]) {
        ctx.beginPath();
        ctx.moveTo(ex - 3, -7);
        ctx.lineTo(ex + 3, -1);
        ctx.moveTo(ex + 3, -7);
        ctx.lineTo(ex - 3, -1);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 8, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Sunglasses, and a grin.
      ctx.beginPath();
      ctx.roundRect(-13, -8, 11, 7, 3);
      ctx.roundRect(2, -8, 11, 7, 3);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-2, -5);
      ctx.lineTo(2, -5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 4, 6, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawText() {
    const ctx = this.ctx;
    ctx.direction = 'rtl';
    ctx.textBaseline = 'top';

    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = C.muted;
    ctx.fillText(`שיא ${pad(this.best)}   ${pad(this.score)}`, 12, 12);

    if (this.state === 'running') return;
    ctx.textAlign = 'center';
    const mid = this.width / 2;
    ctx.fillStyle = C.text;
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillText(this.state === 'over' ? 'אוי! נתקעת בפסקה' : 'Summy Runner', mid, 52);
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = C.pink;
    ctx.fillText(this.state === 'over' ? 'רווח או לחיצה כדי לנסות שוב' : 'רווח או לחיצה כדי לקפוץ מעל הפסקאות', mid, 80);
  }
}

const pad = (n: number) => String(n).padStart(5, '0');
