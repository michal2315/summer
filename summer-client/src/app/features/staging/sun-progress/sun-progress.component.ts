import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SummyComponent } from '../../../shared/easter-eggs/summy/summy.component';

/**
 * The sky through the day, by percent sorted: [at, top, upper, middle, horizon, the sun's glow]. Between two, every
 * colour blends.
 */
const SKY: [number, string, string, string, string, string][] = [
  [0, '#e8834a', '#f9a54e', '#ffc65c', '#ffe372', '#fff4b8'], // sunrise: warm orange melting into yellow
  [18, '#5a95dc', '#8fbde9', '#ffd69a', '#fff0c0', '#fff6cc'], // early morning
  [45, '#1f7fd8', '#3f9ae6', '#7cc4f4', '#cdeeff', '#fffbe6'], // noon: deep blue to pale horizon
  [70, '#3a6db8', '#7a9fd0', '#f2b071', '#ffd98a', '#ffe7a3'], // golden afternoon
  [90, '#2c3f94', '#7b4bb0', '#e0609a', '#ff8f4a', '#ffb36b'], // sunset: blue, purple, pink, orange
  [100, '#060a22', '#0d1238', '#151a48', '#352a68', '#8f86d6'], // night: all sorted
];

/** What time of day it is, by percent sorted (the first whose `upTo` is reached). */
const PHASES: [number, string][] = [
  [0, '🌅 זריחה. יום חדש של מיון מתחיל'],
  [20, '☕ בוקר טוב! הקפה עוד חם'],
  [45, '🏖️ לפני הצהריים, החול כבר חמים'],
  [60, '😎 צהריים, עברתם את חצי הדרך!'],
  [85, '🍉 אחר הצהריים. אבטיח והמשך'],
  [100, '🌇 שקיעה, כמעט שם'],
];

/** The sun's path: a quadratic curve over a 100×40 sky, rising from the sea on the right (RTL start) to the left. */
const P0 = { x: 94, y: 36 };
const P1 = { x: 50, y: -26 };
const P2 = { x: 6, y: 36 };

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) => `rgb(${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t)).join(', ')})`;

/**
 * The staging page's progress, as a summer day: Summy rises out of the sea when sorting starts, is overhead halfway,
 * and sets when it is done, under a sky that goes from sunrise to sunset (and a starry night at 100%).
 */
@Component({
  selector: 'app-sun-progress',
  imports: [SummyComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sun-progress.component.html',
  styleUrl: './sun-progress.component.scss',
  host: {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'percent()',
    'aria-label': 'התקדמות המיון',
    '[class.night]': 'done()',
  },
})
export class SunProgressComponent {
  readonly total = input.required<number>();
  readonly left = input.required<number>();
  readonly collections = input(0);
  readonly collectionsDone = input(0);

  readonly percent = computed(() => {
    const total = this.total();
    return total ? Math.min(100, Math.max(0, Math.round(((total - this.left()) / total) * 100))) : 100;
  });
  readonly done = computed(() => this.percent() === 100);

  readonly sky = computed(() => {
    const p = this.percent();
    const i = Math.max(0, SKY.findIndex(([at]) => at >= p) - 1);
    const [a, b] = [SKY[i], SKY[Math.min(i + 1, SKY.length - 1)]];
    const t = b[0] === a[0] ? 1 : (p - a[0]) / (b[0] - a[0]);
    return { top: mix(a[1], b[1], t), upper: mix(a[2], b[2], t), middle: mix(a[3], b[3], t), horizon: mix(a[4], b[4], t), glow: mix(a[5], b[5], t) };
  });

  /** Where Summy is on the curve, in percent of the sky's width and height. */
  readonly sun = computed(() => {
    const t = this.percent() / 100;
    const u = 1 - t;
    const x = u * u * P0.x + 2 * u * t * P1.x + t * t * P2.x;
    const y = u * u * P0.y + 2 * u * t * P1.y + t * t * P2.y;
    return { left: x, top: (y / 40) * 100 };
  });

  readonly phase = computed(() => {
    const p = this.percent();
    if (p === 100) return '🌙 לילה טוב! הכל ממוין. אפשר ללכת לים';
    return [...PHASES].reverse().find(([from]) => p >= from)![1];
  });


  /** A few stars for the night sky (fixed spots, so they don't jump around). */
  readonly stars = [
    [12, 18],
    [24, 40],
    [33, 12],
    [47, 30],
    [58, 10],
    [66, 38],
    [78, 20],
    [88, 34],
    [18, 58],
    [72, 56],
  ];
}
