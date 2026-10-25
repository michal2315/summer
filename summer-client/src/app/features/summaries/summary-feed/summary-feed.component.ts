import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { UserService } from '../../../core/auth/user.service';
import { SummaryBrowserComponent } from '../summary-browser/summary-browser.component';

@Component({
  selector: 'app-summary-feed',
  imports: [RouterLink, NzButtonModule, NzIconModule, SummaryBrowserComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-feed.component.html',
  styleUrl: './summary-feed.component.scss',
})
export class SummaryFeedComponent {
  readonly userId = inject(UserService).userId;
}
