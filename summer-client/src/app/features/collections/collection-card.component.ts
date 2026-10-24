import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzTagModule } from 'ng-zorro-antd/tag';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ICollection } from '../../shared/models';
import { DateFormatPipe } from '../../shared/pipes/pipes';

/** A collection rendered with the same structure and styles as a summary card (styles/_card.scss). */
@Component({
  selector: 'app-collection-card',
  imports: [RouterLink, NzIconModule, NzTagModule, NzToolTipModule, AvatarComponent, DateFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.active]': 'active()',
    '[style.--stripe]': 'stripe()',
  },
  template: `
    @let c = collection();
    <article class="card" [attr.aria-label]="c.name">
      <header class="head">
        <app-avatar [user]="c.createdBy" [size]="28" />
        <div class="meta">
          <div class="who">
            <a [routerLink]="['/profile', c.createdBy._id]" class="name">{{ c.createdBy.fullName }}</a>
            <span class="dept">· {{ c.managers.length === 1 ? 'מנהל/ת אחד/ת' : c.managers.length + ' מנהלים' }}</span>
          </div>
          <div class="dates">
            <span nz-tooltip="עודכן"><span nz-icon nzType="clock-circle"></span> {{ c.updatedAt | dateFormat }}</span>
            <span nz-tooltip="נוצר"><span nz-icon nzType="calendar"></span> {{ c.createdAt | dateFormat: 'dd/MM/yyyy' }}</span>
          </div>
        </div>

        <div class="side">
          <span class="type"><span nz-icon nzType="folder"></span> אוסף</span>
          <button class="icon" type="button" (click)="selected.emit(c)" [nz-tooltip]="active() ? 'סגירת הפרטים' : 'פרטי האוסף'" [attr.aria-pressed]="active()" aria-label="פרטי האוסף">
            <span nz-icon [nzType]="active() ? 'eye-invisible' : 'eye'"></span>
          </button>
          <button class="icon" type="button" (click)="pinToggle.emit(c)" [nz-tooltip]="pinned() ? 'ביטול נעיצה' : 'נעיצה'" [attr.aria-pressed]="pinned()" aria-label="נעיצה">
            <span nz-icon nzType="pushpin" [nzTheme]="pinned() ? 'fill' : 'outline'"></span>
          </button>
          <button class="icon" type="button" (click)="opened.emit(c)" nz-tooltip="פתיחת האוסף" aria-label="פתיחת האוסף">
            <span nz-icon nzType="arrow-left"></span>
          </button>
        </div>
      </header>

      <button type="button" class="body" (click)="selected.emit(c)" (dblclick)="opened.emit(c)">
        <h3 class="title">{{ c.name }}</h3>
        <div class="preview">{{ preview() }}</div>
      </button>

      <footer class="foot">
        <div class="labels">
          @for (p of c.permissions; track p._id) {
            <nz-tag class="label-chip"><i class="dot" [style.background]="p.color"></i>{{ p.name }}</nz-tag>
          } @empty {
            <nz-tag class="label-chip">פתוח לכולם</nz-tag>
          }
        </div>
        <div class="stats">
          <span class="stat" nz-tooltip="סיכומים באוסף"><span nz-icon nzType="file-text"></span> {{ c.summaries.length }}</span>
          <button class="icon" type="button" (click)="favoriteToggle.emit(c)" [nz-tooltip]="favorite() ? 'הסרה ממועדפים' : 'הוספה למועדפים'" [attr.aria-pressed]="favorite()" aria-label="מועדפים">
            <span nz-icon nzType="star" [nzTheme]="favorite() ? 'fill' : 'outline'" [class.fav]="favorite()"></span>
          </button>
        </div>
      </footer>
    </article>
  `,
  styles: `
    @use 'card';
    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-inline-end: 4px; }
  `,
})
export class CollectionCardComponent {
  readonly collection = input.required<ICollection>();
  readonly active = input(false);
  readonly pinned = input(false);
  readonly favorite = input(false);

  readonly selected = output<ICollection>();
  readonly opened = output<ICollection>();
  readonly pinToggle = output<ICollection>();
  readonly favoriteToggle = output<ICollection>();

  /** Side stripe uses the first permission group's color, like a summary's color stripe. */
  readonly stripe = computed(() => this.collection().permissions[0]?.color ?? 'transparent');
  readonly preview = computed(() => {
    const c = this.collection();
    const n = c.summaries.length;
    const count = n === 0 ? 'אין עדיין סיכומים באוסף' : n === 1 ? 'סיכום אחד באוסף' : `${n} סיכומים באוסף`;
    const access = c.permissions.length ? `גלוי ל: ${c.permissions.map((p) => p.name).join(', ')}` : 'גלוי לכולם';
    return `${count}. ${access}.`;
  });
}
