import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { Subject, debounceTime, distinctUntilChanged, startWith, switchMap } from 'rxjs';
import { IPouchFormat } from '../../../../shared/models';
import { PouchService } from '../../../../shared/services/pouch.service';
import { POUCH_MODE_LABEL } from '../pouch-formats.component';

const PAGE = 30;

/** Others' shared Pouch formats: search by name or owner, copy one to your own (private) formats. */
@Component({
  selector: 'app-shared-pouch-formats',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzInputModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shared-pouch-formats.component.html',
  styleUrl: './shared-pouch-formats.component.scss',
})
export class SharedPouchFormatsComponent {
  private readonly pouch = inject(PouchService);
  private readonly message = inject(NzMessageService);

  readonly modeLabel = POUCH_MODE_LABEL;
  readonly text = signal('');
  readonly list = signal<IPouchFormat[] | null>(null);
  readonly more = signal(false);
  readonly copying = signal<string | null>(null);
  /** Ids copied while the dialog is open. */
  readonly copied = signal(new Set<string>());
  private readonly text$ = new Subject<string>();

  constructor() {
    this.text$
      .pipe(
        startWith(''),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((t) => {
          this.list.set(null);
          return this.pouch.shared(t);
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => {
        this.list.set(list);
        this.more.set(list.length === PAGE);
      });
  }

  onText(t: string) {
    this.text.set(t);
    this.text$.next(t);
  }

  loadMore() {
    const current = this.list() ?? [];
    this.pouch.shared(this.text(), current.length).subscribe((next) => {
      this.list.set([...current, ...next]);
      this.more.set(next.length === PAGE);
    });
  }

  copy(f: IPouchFormat) {
    this.copying.set(f._id);
    this.pouch.copy(f._id).subscribe({
      next: (mine) => {
        this.copying.set(null);
        this.copied.update((s) => new Set(s).add(f._id));
        this.message.success(`הפורמט "${mine.name}" נוסף לפורמטים שלך`);
      },
      error: () => this.copying.set(null),
    });
  }
}
