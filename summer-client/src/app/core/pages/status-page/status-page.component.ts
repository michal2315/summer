import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzResultModule } from 'ng-zorro-antd/result';
import { APP_CONFIG } from '../../config/app-config';

type Kind = 'not-found' | 'server-error' | 'user-not-found' | 'unauthorized';

const COPY: Record<Kind, { status: '404' | '500' | '403' | 'warning'; title: string; sub: string; button: string }> = {
  'not-found': { status: '404', title: 'אופס, הדף לא נמצא', sub: 'ייתכן שהקישור שגוי או שהדף הוסר.', button: 'אני רוצה הביתה' },
  'server-error': { status: '500', title: 'אוי... יש איזושהי בעיה', sub: '(זה לא אתם, זה אנחנו)', button: 'בחזרה למערכת' },
  'user-not-found': { status: 'warning', title: 'המשתמש/ת לא נמצא/ה', sub: '', button: 'חזור לדף הבית' },
  unauthorized: { status: '403', title: 'אין לך הרשאה למערכת', sub: 'אם לדעתך זו טעות, פנו אלינו.', button: 'בחזרה לדף הבית' },
};

@Component({
  selector: 'app-status-page',
  imports: [NzResultModule, NzButtonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-page.component.html',
  styleUrl: './status-page.component.scss',
})
export class StatusPageComponent {
  private readonly config = inject(APP_CONFIG);
  readonly kind: Kind = inject(ActivatedRoute).snapshot.data['kind'] ?? 'not-found';
  readonly copy = COPY[this.kind];
  readonly mailto = `mailto:${this.config.usersMail.join(',')}?subject=${encodeURIComponent('תקלה במערכת Summer')}`;
}
