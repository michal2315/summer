import { AltKeyDirective } from '../../../shared/keyboard/alt-key.directive';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { UserService } from '../../../core/auth/user.service';
import { SummaryBrowserComponent } from '../summary-browser/summary-browser.component';
import { EmptyState } from '../summary-list/summary-list.component';

@Component({
  selector: 'app-summary-feed',
  imports: [AltKeyDirective, RouterLink, NzButtonModule, NzIconModule, SummaryBrowserComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-feed.component.html',
  styleUrl: './summary-feed.component.scss',
})
export class SummaryFeedComponent {
  readonly userId = inject(UserService).userId;
  readonly empty: EmptyState = {
    title: 'עדיין אין כאן תמציות',
    hint: 'תמציות שפורסמו ויש לך הרשאה לראות יופיעו כאן.',
    action: { label: 'כתיבת תמצית חדשה', link: ['/summaries/new'] },
  };
}
