import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { IContentType } from '../models';

const ICONS: Record<string, string> = {
  lecture: 'read',
  video: 'video-camera',
  textbook: 'book',
  article: 'file-text',
  seminar: 'team',
  generic: 'appstore',
};

@Component({
  selector: 'app-content-type-icon',
  imports: [NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span nz-icon [nzType]="icon()" [style.color]="type()?.color || null"></span>`,
})
export class ContentTypeIconComponent {
  readonly type = input<IContentType | null | undefined>();
  readonly icon = computed(() => ICONS[this.type()?.name ?? ''] ?? 'file');
}
