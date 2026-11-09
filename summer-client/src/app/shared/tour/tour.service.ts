import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { UserService } from '../../core/auth/user.service';
import { StorageService } from '../../core/storage/storage.service';
import { AltKeysService } from '../keyboard/alt-keys.service';
import { NEW_DAYS, TOUR_TOPICS, TourContext, TourStep, TourTopic, WELCOME_STEP } from './tour-spec';

const KEYS = { done: 'tour.done', seen: 'tour.seen', nudged: 'tour.nudged' };

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

/**
 * The guided tour: which steps run, which one is current, and what the user has already seen.
 * Rendering, spotlight and keyboard live in TourOverlayComponent.
 */
@Injectable({ providedIn: 'root' })
export class TourService {
  private readonly router = inject(Router);
  private readonly storage = inject(StorageService);
  private readonly users = inject(UserService);
  private readonly altKeys = inject(AltKeysService);

  readonly topics = TOUR_TOPICS;
  readonly core = TOUR_TOPICS.find((t) => t.core);
  private readonly topicOfStep = new Map<TourStep, TourTopic>(TOUR_TOPICS.flatMap((t) => t.steps.map((s) => [s, t] as const)));
  private readonly allSteps = TOUR_TOPICS.flatMap((t) => t.steps);

  private readonly seen = signal(new Set(this.storage.get<string[]>(KEYS.seen) ?? []));
  readonly unseenNew = computed(() => this.allSteps.filter((s) => this.isNew(s) && !this.seen().has(s.id)));

  readonly steps = signal<TourStep[]>([]);
  readonly index = signal(0);
  readonly current = computed<TourStep | null>(() => this.steps()[this.index()] ?? null);
  readonly isFirst = computed(() => this.index() === 0);
  readonly isLast = computed(() => this.index() === this.steps().length - 1);

  /** The element the hub opens next to; null = hub closed. */
  readonly hubAnchor = signal<HTMLElement | null>(null);
  readonly nudgeOpen = signal(false);

  readonly ctx: TourContext = {
    go: async (path) => {
      if (this.router.url.split(/[?#]/)[0] !== path) await this.router.navigateByUrl(path);
      await frame();
    },
    url: () => this.router.url,
    userId: () => this.users.userId(),
    showShortcuts: () => this.altKeys.toggleHelp(true),
  };

  isNew(step: TourStep): boolean {
    return !!step.added && (Date.now() - new Date(step.added).getTime()) / 864e5 <= NEW_DAYS;
  }

  topicTitle(step: TourStep): string {
    return step === WELCOME_STEP ? (this.core?.title ?? '') : (this.topicOfStep.get(step)?.title ?? '');
  }

  start(steps: TourStep[]) {
    this.closeHub();
    this.nudgeOpen.set(false);
    if (!steps.length) return;
    this.index.set(0);
    this.steps.set(steps);
  }

  startNew() {
    this.storage.set(KEYS.nudged, true, 'session');
    this.start(this.unseenNew());
  }

  welcome() {
    this.start([WELCOME_STEP, ...(this.core?.steps ?? [])]);
  }

  /** First visit → the basics tour (returns true). Otherwise offers unseen new steps, once per session. */
  greet(): boolean {
    if (!this.storage.get<boolean>(KEYS.done)) {
      this.welcome();
      return true;
    }
    if (this.unseenNew().length && !this.storage.get<boolean>(KEYS.nudged, 'session')) this.nudgeOpen.set(true);
    return false;
  }

  dismissNudge() {
    this.storage.set(KEYS.nudged, true, 'session');
    this.nudgeOpen.set(false);
  }

  go(delta: 1 | -1) {
    const next = this.index() + delta;
    if (next < 0) return;
    if (next >= this.steps().length) this.end();
    else this.index.set(next);
  }

  end() {
    if (!this.steps().length) return;
    if (this.steps().some((s) => this.topicOfStep.get(s)?.core)) this.storage.set(KEYS.done, true);
    this.steps.set([]);
  }

  markSeen(step: TourStep) {
    if (this.seen().has(step.id)) return;
    const seen = new Set(this.seen()).add(step.id);
    this.seen.set(seen);
    this.storage.set(KEYS.seen, [...seen]);
  }

  toggleHub(anchor: HTMLElement) {
    if (this.hubAnchor()) return this.closeHub();
    this.end();
    this.hubAnchor.set(anchor);
  }

  closeHub() {
    this.hubAnchor.set(null);
  }

  /** Show everything again, as on a first visit. */
  reset() {
    this.storage.remove(KEYS.done);
    this.storage.remove(KEYS.seen);
    this.seen.set(new Set());
  }
}
