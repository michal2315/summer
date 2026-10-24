import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { UserService } from '../../core/auth/user.service';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { UserRef } from '../../shared/models';
import { SummaryBrowserComponent } from '../summaries/summary-browser/summary-browser.component';

@Component({
  selector: 'app-profile',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzSkeletonModule, AvatarComponent, SummaryBrowserComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (profile(); as p) {
      <app-summary-browser [ownerId]="p._id" [isProfile]="true" [showTabs]="isOwn()" [searchPlaceholder]="'חיפוש בסיכומים של ' + p.fullName">
        <header browser-header class="header">
          <app-avatar [user]="p" [size]="70" />
          <div class="who">
            <h1 class="page-title">{{ p.fullName }}</h1>
            <span class="muted">{{ p.department }}</span>
          </div>
          <span class="spacer"></span>
          @if (isOwn()) {
            <a nz-button nzType="primary" routerLink="/summaries/new"><span nz-icon nzType="plus"></span> סיכום חדש</a>
          } @else {
            <button nz-button [nzType]="isFollowing() ? 'default' : 'primary'" [nzLoading]="busy()" (click)="toggleFollow(p._id)">
              {{ isFollowing() ? 'הסר עוקב' : 'עקוב' }}
            </button>
          }
        </header>
      </app-summary-browser>
    } @else {
      <div class="loading"><nz-skeleton [nzActive]="true" [nzAvatar]="{ size: 70 }" /></div>
    }
  `,
  styles: `
    :host { display: block; height: 100%; }
    .header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .who { display: flex; flex-direction: column; }
    .spacer { flex: 1; }
    .loading { padding: 32px; }
  `,
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
