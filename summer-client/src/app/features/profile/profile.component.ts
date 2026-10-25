import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { UserService } from '../../core/auth/user.service';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { UserRef } from '../../shared/models';
import { SummaryBrowserComponent } from '../summaries/summary-browser/summary-browser.component';

@Component({
  selector: 'app-profile',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzSkeletonModule, AvatarComponent, SummaryBrowserComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent {
  private readonly users = inject(UserService);
  private readonly router = inject(Router);

  readonly userId = input.required<string>();
  readonly profile = signal<UserRef | null>(null);
  readonly busy = signal(false);

  readonly isOwn = computed(() => this.userId() === this.users.userId());
  readonly isFollowing = computed(() => this.users.user()?.following.includes(this.userId()) ?? false);

  constructor() {
    effect(() => {
      const id = this.userId();
      untracked(() => {
        this.profile.set(null);
        this.users.byIds([id]).subscribe({
          next: ([u]) => (u ? this.profile.set(u) : this.router.navigate(['/user-not-found'], { skipLocationChange: true })),
          error: () => this.router.navigate(['/user-not-found'], { skipLocationChange: true }),
        });
      });
    });
  }

  toggleFollow(id: string) {
    this.busy.set(true);
    const req = this.isFollowing() ? this.users.unfollow(id) : this.users.follow(id);
    req.subscribe({ complete: () => this.busy.set(false), error: () => this.busy.set(false) });
  }
}
