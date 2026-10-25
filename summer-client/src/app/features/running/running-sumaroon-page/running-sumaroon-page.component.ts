import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { SummaryDetailComponent } from '../../summaries/summary-detail/summary-detail.component';

/** /running/:id/s/:sumaroonId — one sumaroon full screen, with a way back to its running summary. */
@Component({
  selector: 'app-running-sumaroon-page',
  imports: [NzButtonModule, NzIconModule, SummaryDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './running-sumaroon-page.component.html',
  styleUrl: './running-sumaroon-page.component.scss',
})
export class RunningSumaroonPageComponent {
  private readonly router = inject(Router);
  private readonly params = toSignal(inject(ActivatedRoute).queryParams, { initialValue: {} as Params });

  readonly id = input.required<string>();
  readonly sumaroonId = input.required<string>();
  readonly runningLink = computed(() => ['/running', this.id()]);

  /** Back to the running summary with the same list filters, this sumaroon open in the panel. */
  back() {
    this.router.navigate(this.runningLink(), { queryParams: { ...this.params(), summaryId: this.sumaroonId() } });
  }
}
