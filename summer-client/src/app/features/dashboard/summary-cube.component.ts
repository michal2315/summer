import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { AvatarComponent } from '../../shared/components/avatar.component';
import { ISummary } from '../../shared/models';
import { DateFormatPipe, PlainTextPipe } from '../../shared/pipes/pipes';

/** Dashboard mini card: author, title, preview, permission dots, comment count. */
@Component({
  selector: 'app-summary-cube',
  imports: [RouterLink, NzIconModule, NzToolTipModule, AvatarComponent, DateFormatPipe, PlainTextPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = summary();
    <a class="cube" [routerLink]="['/summaries']" [queryParams]="{ summaryId: s._id }" [style.border-top-color]="s.color || 'transparent'">
      <header>
        <app-avatar [user]="s.user" [isDraft]="s.isDraft" [size]="28" />
        <span class="who">
          <strong>{{ s.user.fullName }}</strong>
          <small>{{ s.department || s.user.department }} · {{ s.eventDate || s.creationDate | dateFormat: 'dd/MM/yyyy' }}</small>
        </span>
      </header>
      <h3>{{ s.title }}</h3>
      <p>{{ s.content | plainText: 140 }}</p>
      <footer>
        <span class="perms">
          @for (p of s.permissions; track p._id) {
            <i [style.background]="p.color" [nz-tooltip]="p.name"></i>
          }
        </span>
        <span class="comments"><span nz-icon nzType="message"></span> {{ s.comments.length }}</span>
      </footer>
    </a>
  `,
  styles: `
    .cube { display: flex; flex-direction: column; gap: 6px; height: 100%; padding: 10px 12px; background: #fff; border-radius: 10px; border-top: 3px solid; box-shadow: 0 2px 20px rgba(0,0,0,.06); color: #05043d; transition: box-shadow .15s; }
    .cube:hover { box-shadow: 0 2px 20px rgba(0,0,0,.18); }
    header { display: flex; gap: 8px; align-items: center; }
    .who { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
    .who strong { font-size: 13px; }
    .who small { font-size: 11px; color: #9b9bb1; }
    h3 { font-size: 14px; font-weight: 800; margin: 0; }
    p { font-size: 12px; color: #666; margin: 0; flex: 1; }
    footer { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #666; }
    .perms { display: flex; gap: 4px; }
    .perms i { width: 9px; height: 9px; border-radius: 50%; }
  `,
})
export class SummaryCubeComponent {
  readonly summary = input.required<ISummary>();
}
