import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { StorageService } from '../../../core/storage/storage.service';
import { SkeletonComponent } from '../../components/skeleton/skeleton.component';
import { confetti } from '../confetti';
import { MILESTONES } from './milestones';

const SEEN_KEY = 'seenMilestones';

/** A row of milestone badges for a profile. Earning a new one on your own profile gets confetti, once. */
@Component({
  selector: 'app-milestones',
  imports: [NzToolTipModule, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', 'aria-label': 'אבני דרך' },
  templateUrl: './milestones.component.html',
  styleUrl: './milestones.component.scss',
})
export class MilestonesComponent {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(StorageService);

  readonly userId = input.required<string>();
  readonly isOwn = input(false);

  /** Ids of the milestones earned; null while loading. */
  private readonly earned = signal<ReadonlySet<string> | null>(null);
  /** Earned since this user last saw their own profile. */
  private readonly fresh = signal<ReadonlySet<string>>(new Set());

  readonly badges = computed(() =>
    MILESTONES.map((m) => ({
      ...m,
      earned: this.earned()?.has(m.id) ?? false,
      fresh: this.fresh().has(m.id),
    })),
  );
  readonly earnedCount = computed(() => this.badges().filter((b) => b.earned).length);
  readonly loaded = computed(() => !!this.earned());

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => {
        this.earned.set(null);
        this.http.get<{ earned: string[] }>(`/api/milestones/${id}`).subscribe(({ earned }) => {
          this.earned.set(new Set(earned));
          if (this.isOwn()) this.celebrate(id, earned);
        });
      });
    });
  }

  private celebrate(userId: string, earned: string[]) {
    const key = `${SEEN_KEY}.${userId}`;
    const seen = this.storage.get<string[]>(key);
    this.storage.set(key, earned);
    // First visit just records what is already earned — confetti is for milestones reached from now on.
    if (!seen) return;
    const fresh = earned.filter((id) => !seen.includes(id));
    if (!fresh.length) return;
    this.fresh.set(new Set(fresh));
    setTimeout(confetti, 400);
  }
}
