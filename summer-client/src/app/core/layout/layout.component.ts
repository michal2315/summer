import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { WhatsNewService } from '../../shared/components/whats-new';
import { RouterOutlet } from '@angular/router';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { SideNavComponent } from './side-nav/side-nav.component';

@Component({
  selector: 'app-layout',
  imports: [NzLayoutModule, RouterOutlet, SideNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
})
export class LayoutComponent {
  readonly collapsed = signal(false);

  constructor() {
    inject(WhatsNewService).showIfUnseen();
  }

  /** On narrow screens the sider overlays content — close it after a nav click. */
  onNavigate() {
    if (window.innerWidth < 992) this.collapsed.set(true);
  }
}
