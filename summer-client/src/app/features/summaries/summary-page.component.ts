import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { ISummary, SummaryKind } from '../../shared/models';
import { SummaryDetailComponent } from './summary-detail/summary-detail.component';

/** Standalone full-page detail: /summaries/:id (bound from the route via withComponentInputBinding). */
@Component({
  selector: 'app-summary-page',
  imports: [SummaryDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-summary-detail [summaryId]="id()" mode="page" (loaded)="onLoaded($event)" />`,
  styles: `:host { display: block; padding: 24px 16px; }`,
})
export class SummaryPageComponent {
  private readonly router = inject(Router);
  readonly id = input.required<string>();

  /** A running summary has its own page. */
  onLoaded(s: ISummary) {
    if (s.kind === SummaryKind.Running) this.router.navigate(['/running', s._id], { replaceUrl: true });
  }
}
