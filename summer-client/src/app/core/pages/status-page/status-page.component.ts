import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { APP_CONFIG } from '../../config/app-config';
import { SummyComponent, SummyMood } from '../../../shared/easter-eggs/summy/summy.component';
import { SummyRunnerComponent } from '../../../shared/easter-eggs/summy-runner/summy-runner.component';

type Kind = 'not-found' | 'server-error' | 'user-not-found' | 'unauthorized';

const COPY: Record<Kind, { mood: SummyMood; title: string; sub: string; button: string }> = {
  'not-found': { mood: 'lost', title: 'אופס, הדף לא נמצא', sub: 'ייתכן שהקישור שגוי או שהדף הוסר.', button: 'אני רוצה הביתה' },
  'server-error': { mood: 'error', title: 'אוי... יש איזושהי בעיה', sub: '(זה לא אתם, זה אנחנו)', button: 'בחזרה למערכת' },
  'user-not-found': { mood: 'lost', title: 'המשתמש/ת לא נמצא/ה', sub: '', button: 'חזור לדף הבית' },
  unauthorized: { mood: 'locked', title: 'אין לך הרשאה למערכת', sub: 'אם לדעתך זו טעות, פנו אלינו.', button: 'בחזרה לדף הבית' },
};

@Component({
  selector: 'app-status-page',
  imports: [NzButtonModule, RouterLink, SummyComponent, SummyRunnerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-page.component.html',
  styleUrl: './status-page.component.scss',
})
export class StatusPageComponent {
  private readonly config = inject(APP_CONFIG);
  readonly kind: Kind = inject(ActivatedRoute).snapshot.data['kind'] ?? 'not-found';
  readonly copy = COPY[this.kind];
  readonly playing = signal(false);
  readonly mailto = `mailto:${this.config.usersMail.join(',')}?subject=${encodeURIComponent('תקלה במערכת Summer')}`;
}
