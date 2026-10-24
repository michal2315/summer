import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { catchError, of } from 'rxjs';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { WhatsNewService } from '../../shared/components/whats-new';
import { CatalogService } from '../../shared/services/catalog.service';
import { AuthService } from '../auth/auth.service';
import { UserService } from '../auth/user.service';
import { APP_CONFIG } from '../config/app-config';

interface NavItem {
  label: string;
  icon: string;
  link: string[];
}

@Component({
  selector: 'app-side-nav',
  imports: [RouterLink, RouterLinkActive, NzIconModule, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './side-nav.component.html',
  styleUrl: './side-nav.component.scss',
})
export class SideNavComponent {
  private readonly users = inject(UserService);
  private readonly auth = inject(AuthService);
  private readonly config = inject(APP_CONFIG);
  private readonly dashboardPermitted = toSignal(inject(CatalogService).dashboardAccess().pipe(catchError(() => of(false))), {
    initialValue: false,
  });

  readonly whatsNew = inject(WhatsNewService);
  readonly navigate = output<void>();
  readonly user = this.users.user;
  /** Fixed identity on the mock API — logging out would just bounce back in. */
  readonly canLogout = !this.config.mockApi;
  readonly contactHref = `mailto:${this.config.usersMail.join(',')}?subject=${encodeURIComponent('פנייה בנושא Summer')}`;

  readonly items = computed<NavItem[]>(() => {
    const items: NavItem[] = [
      { label: 'דף הבית', icon: 'home', link: ['/summaries'] },
      { label: 'פרופיל', icon: 'user', link: ['/profile', this.users.userId() ?? ''] },
      { label: 'אוספים', icon: 'folder', link: ['/collections'] },
      { label: 'היררכיה', icon: 'apartment', link: ['/hierarchy'] },
      { label: 'התראות', icon: 'notification', link: ['/notifications'] },
      { label: 'הרשאות', icon: 'lock', link: ['/permissions'] },
      { label: 'תוסף', icon: 'appstore-add', link: ['/extension'] },
    ];
    if (this.dashboardPermitted()) items.push({ label: 'דשבורד', icon: 'dashboard', link: ['/dashboard'] });
    return items;
  });

  logout() {
    this.auth.logout();
  }
}
