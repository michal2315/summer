import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { format } from 'date-fns';
import { NzContextMenuService, NzDropDownModule, NzDropdownMenuComponent } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { Observable } from 'rxjs';
import { IPouchFormat } from '../../../shared/models';
import { PouchService } from '../../../shared/services/pouch.service';
import { PouchLauncher } from '../../pouch/pouch-launcher.service';
import { PouchShareComponent, PouchShareData } from '../../pouch/pouch-share/pouch-share.component';
import { SharedPouchFormatsComponent } from './shared-pouch-formats/shared-pouch-formats.component';

export const POUCH_MODE_LABEL: Record<IPouchFormat['mode'], string> = { perSummary: 'בלוק לכל תמצית', combined: 'מאוחד' };

/**
 * The user's Pouch formats (personal export formats) as cards on the profile shelf, in two lists: their own, and the
 * ones others shared with them (with what they may do: use, or edit). A card opens the format in Pouch (view only
 * without edit rights); the right-click menu favourites, shares, duplicates or deletes one's own, and copies others'. `create` and `browseShared` are the shelf's buttons.
 */
@Component({
  selector: 'app-pouch-formats',
  imports: [NzDropDownModule, NzIconModule, NzToolTipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pouch-formats.component.html',
  styleUrl: './pouch-formats.component.scss',
})
export class PouchFormatsComponent {
  readonly pouch = inject(PouchService);
  private readonly launcher = inject(PouchLauncher);
  private readonly message = inject(NzMessageService);
  private readonly modal = inject(NzModalService);
  private readonly contextMenu = inject(NzContextMenuService);

  /** Narrows the cards by name, or for shared ones by who shared them (the shelf's filter box). */
  readonly filter = input('');
  /** My formats, or the ones others shared with me personally. */
  readonly view = signal<'mine' | 'shared'>('mine');
  private readonly found = computed(() => this.pouch.search(this.filter()));
  readonly mine = computed(() => this.found().filter((f) => f.isMine));
  readonly sharedWithMe = computed(() => this.found().filter((f) => !f.isMine));
  readonly list = computed(() => (this.view() === 'mine' ? this.mine() : this.sharedWithMe()));
  readonly roleLabel = { editor: 'עריכה', viewer: 'שימוש' } as Record<string, string>;

  /** Ids with a request in flight. */
  readonly busy = signal(new Set<string>());

  constructor() {
    this.pouch.ensureLoaded();
  }

  openMenu(event: MouseEvent, menu: NzDropdownMenuComponent) {
    event.preventDefault();
    this.contextMenu.create(event, menu);
  }

  describe(f: IPouchFormat) {
    const whose = f.isMine ? (f.members.length ? ` · משותף עם ${f.members.length}` : '') : ` · של ${f.owner.fullName}`;
    return `${POUCH_MODE_LABEL[f.mode]}${whose} · עודכן ${format(new Date(f.updateDate), 'dd/MM/yyyy')}`;
  }

  create() {
    this.launcher.edit().subscribe();
  }

  edit(f: IPouchFormat) {
    this.launcher.edit(f).subscribe();
  }

  browseShared() {
    this.modal.create({ nzTitle: 'פורמטים משותפים', nzContent: SharedPouchFormatsComponent, nzFooter: null, nzWidth: 560 });
  }

  toggleFavorite(f: IPouchFormat) {
    this.track(f, this.pouch.update(f._id, { isFavorite: !f.isFavorite }), () => {});
  }

  /** Sharing with everyone and the editors (owner only). */
  share(f: IPouchFormat) {
    this.modal.create<PouchShareComponent, PouchShareData, IPouchFormat>({ nzTitle: `שיתוף "${f.name}"`, nzContent: PouchShareComponent, nzData: { format: f }, nzFooter: null, nzWidth: 480 });
  }

  duplicate(f: IPouchFormat) {
    this.track(f, this.pouch.copy(f._id), () => this.message.success('הפורמט שוכפל'));
  }

  remove(f: IPouchFormat) {
    this.modal.confirm({
      nzTitle: `למחוק את הפורמט "${f.name}"?`,
      nzContent: f.isShared ? 'הפורמט משותף — מי שלא העתיק אותו לא יוכל להשתמש בו יותר.' : undefined,
      nzOkText: 'מחיקה',
      nzOkDanger: true,
      nzCancelText: 'ביטול',
      nzOnOk: () => this.track(f, this.pouch.remove(f._id), () => this.message.success('הפורמט נמחק')),
    });
  }

  isBusy(f: IPouchFormat) {
    return this.busy().has(f._id);
  }

  private track(f: IPouchFormat, req: Observable<unknown>, next: () => void) {
    if (this.isBusy(f)) return;
    const set = (on: boolean) =>
      this.busy.update((b) => {
        const copy = new Set(b);
        if (on) copy.add(f._id);
        else copy.delete(f._id);
        return copy;
      });
    set(true);
    req.subscribe({ next, error: () => set(false), complete: () => set(false) });
  }
}
