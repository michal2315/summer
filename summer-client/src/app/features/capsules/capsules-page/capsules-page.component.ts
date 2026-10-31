import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { catchError, debounceTime, of, switchMap } from 'rxjs';
import { CapsuleWordsComponent } from '../../../shared/components/capsules/capsule-words/capsule-words.component';
import { ICapsule } from '../../../shared/models';
import { CapsuleService } from '../../../shared/services/capsule.service';
import { capsuleSearchToken } from '../../../shared/utils/capsules';

/**
 * /capsules — the capsules from the external service, read only: filter by name, see the words by condition,
 * search with one or turn it into a notification rule.
 */
@Component({
  selector: 'app-capsules-page',
  imports: [NzButtonModule, NzEmptyModule, NzIconModule, NzInputModule, NzSkeletonModule, NzToolTipModule, CapsuleWordsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './capsules-page.component.html',
  styleUrl: './capsules-page.component.scss',
})
export class CapsulesPageComponent {
  private readonly capsules = inject(CapsuleService);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);

  readonly filter = signal('');
  readonly list = toSignal(
    toObservable(this.filter).pipe(
      debounceTime(150),
      switchMap((q) => this.capsules.list(q).pipe(catchError(() => of([] as ICapsule[])))),
    ),
    { initialValue: null },
  );
  readonly count = computed(() => this.list()?.length ?? 0);

  search(c: ICapsule) {
    this.router.navigate(['/summaries'], { queryParams: { q: capsuleSearchToken(c) } });
  }

  alert(c: ICapsule) {
    this.router.navigate(['/notifications/create'], { queryParams: { capsule: c._id } });
  }

  async copy(c: ICapsule) {
    try {
      await navigator.clipboard.writeText(capsuleSearchToken(c));
      this.message.success('הועתק — אפשר להדביק בתיבת החיפוש');
    } catch {
      this.message.error('ההעתקה נכשלה');
    }
  }
}
