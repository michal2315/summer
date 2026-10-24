import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { SummaryDetailComponent } from './summary-detail/summary-detail.component';

/** Standalone full-page detail: /summaries/:id (bound from the route via withComponentInputBinding). */
@Component({
  selector: 'app-summary-page',
  imports: [SummaryDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-summary-detail [summaryId]="id()" mode="page" />`,
  styles: `:host { display: block; padding: 24px 16px; }`,
})
export class SummaryPageComponent {
  readonly id = input.required<string>();
}
