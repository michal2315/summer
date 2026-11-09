/** Brand colors plus the summary palette — confetti should look like Summer. */
const COLORS = ['#ff4056', '#ff9155', '#fab005', '#2dd070', '#00b2b2', '#0000c9', '#800080', '#fe9eae'];
const PIECES = 160;
const DURATION_MS = 3200;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  angle: number;
  spin: number;
  round: boolean;
}

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** One burst of confetti from both top corners, on a throwaway canvas that removes itself. */
export function confetti(): void {
  if (prefersReducedMotion()) return;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '2000' });
  document.body.appendChild(canvas);
  ctx.scale(dpr, dpr);

  const pieces: Piece[] = Array.from({ length: PIECES }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? 0 : w,
      y: h * 0.15,
      vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 9),
      vy: -6 - Math.random() * 10,
      size: 6 + Math.random() * 6,
      color: COLORS[i % COLORS.length],
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      round: Math.random() < 0.3,
    };
  });

  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - DURATION_MS * 0.7) / (DURATION_MS * 0.3));
    for (const p of pieces) {
      p.vy += 0.25;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    if (t < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
