import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { UserService } from '../../core/auth/user.service';
import { SummaryBrowserComponent } from './summary-browser/summary-browser.component';

@Component({
  selector: 'app-summary-feed',
  imports: [RouterLink, NzButtonModule, NzIconModule, SummaryBrowserComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (userId(); as id) {
      <app-summary-browser [ownerId]="id" [excelActions]="true">
        <div browser-header class="header">
          <h1 class="page-title">סיכומים</h1>
          <a nz-button nzType="primary" routerLink="/summaries/new"><span nz-icon nzType="plus"></span> סיכום חדש</a>
        </div>
      </app-summary-browser>
    }
  `,
  styles: `
    :host { display: block; height: 100%; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  `,
})
export class SummaryFeedComponent {
  readonly userId = inject(UserService).userId;
}
