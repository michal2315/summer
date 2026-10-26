import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { catchError, of } from 'rxjs';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { WhatsNewService } from '../../../shared/components/whats-new';
import { PermissionService } from '../../../shared/services/permission.service';
import { UserService } from '../../auth/user.service';
import { APP_CONFIG } from '../../config/app-config';
import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { AltKeyId } from '../../../shared/keyboard/alt-keys';

interface NavItem {
  label: string;
  icon: string;
  link: string[];
  altKey: AltKeyId;
}

@Component({
  selector: 'app-side-nav',
  imports: [RouterLink, RouterLinkActive, NzIconModule, AvatarComponent, AltKeyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './side-nav.component.html',
  styleUrl: './side-nav.component.scss',
})
export class SideNavComponent {
  private readonly users = inject(UserService);
  private readonly config = inject(APP_CONFIG);
  private readonly dashboardPermitted = toSignal(inject(PermissionService).dashboardAccess().pipe(catchError(() => of(false))), {
    initialValue: false,
  });

  readonly whatsNew = inject(WhatsNewService);
  readonly navigate = output<void>();
  readonly user = this.users.user;
  readonly contactHref = `mailto:${this.config.usersMail.join(',')}?subject=${encodeURIComponent('פנייה בנושא Summer')}`;

  readonly items = computed<NavItem[]>(() => {
    const items: NavItem[] = [
      { label: 'דף הבית', icon: 'home', link: ['/summaries'], altKey: 'home' },
      { label: 'פרופיל', icon: 'user', link: ['/profile', this.users.userId() ?? ''], altKey: 'profile' },
      { label: 'לקטים', icon: 'folder', link: ['/collections'], altKey: 'collections' },
      { label: 'היררכיה', icon: 'apartment', link: ['/hierarchy'], altKey: 'hierarchy' },
      { label: 'התראות', icon: 'notification', link: ['/notifications'], altKey: 'notifications' },
      { label: 'הרשאות', icon: 'lock', link: ['/permissions'], altKey: 'permissions' },
      { label: 'תוסף', icon: 'appstore-add', link: ['/extension'], altKey: 'extension' },
    ];
    if (this.dashboardPermitted()) items.push({ label: 'דשבורד', icon: 'dashboard', link: ['/dashboard'], altKey: 'dashboard' });
    return items;
  });
}
