import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCollapseModule } from 'ng-zorro-antd/collapse';
import { NzModalRef } from 'ng-zorro-antd/modal';
import { NzSkeletonModule } from 'ng-zorro-antd/skeleton';
import { RichHtmlPipe } from '../pipes/pipes';
import { Release, WhatsNewService } from './whats-new';

@Component({
  selector: 'app-whats-new-modal',
  imports: [NzButtonModule, NzCollapseModule, NzSkeletonModule, RichHtmlPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (releases(); as list) {
      <nz-collapse [nzBordered]="false">
        @for (r of list; track r.version; let first = $first) {
          <nz-collapse-panel [nzHeader]="'גרסה ' + r.version + (r.isAcknowledged ? '' : ' · חדש')" [nzActive]="first">
            <div class="ql-container ql-snow read-only"><div class="ql-editor" [innerHTML]="r.html | richHtml"></div></div>
          </nz-collapse-panel>
        }
      </nz-collapse>
    } @else {
      <nz-skeleton [nzActive]="true" />
    }
    <footer><button nz-button nzType="primary" type="button" (click)="close()">הבנתי</button></footer>
  `,
  styles: `footer { display: flex; justify-content: flex-end; margin-top: 12px; }`,
})
export class WhatsNewModalComponent {
  private readonly service = inject(WhatsNewService);
  private readonly ref = inject(NzModalRef);
  readonly releases = signal<Release[] | null>(null);

  constructor() {
    this.service.releases().subscribe((list) => this.releases.set(list));
  }

  close() {
    for (const r of this.releases() ?? []) if (!r.isAcknowledged) this.service.acknowledge(r.version).subscribe();
    this.ref.close();
  }
}
