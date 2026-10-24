import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NzAvatarModule } from 'ng-zorro-antd/avatar';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { APP_CONFIG } from '../../core/config/app-config';
import { UserRef } from '../models';

/** Avatar rules (spec §15): drafts → copy icon; system/admin author → app logo; else directory image with initials fallback. */
@Component({
  selector: 'app-avatar',
  imports: [NzAvatarModule, NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isDraft()) {
      <nz-avatar [nzSize]="size()" nzIcon="copy" class="draft" />
    } @else if (user()?.isSystem) {
      <nz-avatar [nzSize]="size()" nzSrc="logos/summer-small-logo.svg" />
    } @else {
      <nz-avatar [nzSize]="size()" [nzSrc]="src()" [nzText]="initials()" [style.background]="bg()" />
    }
  `,
  styles: `
    :host { display: inline-flex; flex-shrink: 0; }
    .draft { background: #efefef; color: #05043d; }
  `,
})
export class AvatarComponent {
  private readonly template = inject(APP_CONFIG).avatarUrl;

  readonly user = input<UserRef | null | undefined>();
  readonly size = input(40);
  readonly isDraft = input(false);

  readonly src = computed(() => {
    const u = this.user();
    return this.template && u ? this.template.replace('{username}', encodeURIComponent(u.username)) : '';
  });
  readonly initials = computed(() =>
    (this.user()?.fullName ?? '?')
      .split(/\s+/)
      .filter((w) => w && !w.endsWith("'"))
      .slice(0, 2)
      .map((w) => w[0])
      .join(''),
  );
  /** Stable pastel per user so lists are scannable. */
  readonly bg = computed(() => {
    const id = this.user()?._id ?? '';
    let h = 0;
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 55% 62%)`;
  });
}
