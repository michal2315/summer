import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { APP_CONFIG } from '../../../core/config/app-config';

/** Sunny team (helpdesk): reporting a problem or suggesting something, each on its own site. */
@Component({
  selector: 'app-helpdesk-modal',
  imports: [NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './helpdesk-modal.component.html',
  styleUrl: './helpdesk-modal.component.scss',
})
export class HelpdeskModalComponent {
  private readonly config = inject(APP_CONFIG);
  readonly options = [
    { label: 'עזרה', hint: 'משהו לא עובד? צוות סאני ישמח לעזור', icon: 'customer-service', url: this.config.helpdeskUrl },
    { label: 'הצעות', hint: 'רעיון לשיפור או פיצ׳ר חדש', icon: 'bulb', url: this.config.suggestionsUrl },
  ];
}
