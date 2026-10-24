import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { WhatsNewService } from '../../shared/components/whats-new';
import { RouterOutlet } from '@angular/router';
import { NzLayoutModule } from 'ng-zorro-antd/layout';
import { SideNavComponent } from './side-nav.component';

@Component({
  selector: 'app-layout',
  imports: [NzLayoutModule, RouterOutlet, SideNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nz-layout class="shell">
      <nz-sider
        class="sider"
        nzWidth="220px"
        nzTheme="light"
        nzBreakpoint="lg"
        [nzCollapsedWidth]="0"
        nzCollapsible
        [(nzCollapsed)]="collapsed"
      >
        <app-side-nav (navigate)="onNavigate()" />
      </nz-sider>
      <nz-content class="content">
        <router-outlet />
      </nz-content>
    </nz-layout>
  `,
  styles: `
    :host { display: block; height: 100vh; }
    .shell { height: 100%; background: #fff; }
    .sider { height: 100%; overflow: auto; }
    .content { margin: 8px; border-radius: 12px; background: #f7f7f7; overflow: auto; min-width: 0; position: relative; }
  `,
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
