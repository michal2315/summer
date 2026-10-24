import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NzAlertModule } from 'ng-zorro-antd/alert';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { AuthService } from '../auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [NzButtonModule, NzAlertModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="page">
      <section class="card">
        <img src="logos/summer-full-logo.svg" alt="Summer" class="logo" />
        <h1>סיכומים משותפים לכל החומר האקדמי</h1>
        <p class="muted">הרצאות, סרטונים, ספרי לימוד ומאמרים — במקום אחד.</p>
        @if (error(); as e) {
          <nz-alert nzType="error" [nzMessage]="e" nzShowIcon />
        }
        <button nz-button nzType="primary" nzSize="large" nzBlock [nzLoading]="busy()" (click)="login()">התחברות עם חשבון האוניברסיטה</button>
      </section>
    </main>
  `,
  styles: `
    .page { min-height: 100vh; display: grid; place-items: center; background: #f7f7f7; padding: 16px; }
    .card { width: min(420px, 100%); background: #fff; border-radius: 15px; padding: 40px 32px; box-shadow: 0 2px 20px rgba(0,0,0,.08); display: flex; flex-direction: column; gap: 16px; text-align: center; }
    .logo { height: 56px; margin: 0 auto 8px; }
    h1 { font-size: 22px; font-weight: 800; margin: 0; }
    p { margin: 0; }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async login() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login();
    } catch (e) {
      const reason = (e as Error)?.message;
      this.error.set(
        reason === 'popup-blocked'
          ? 'הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים לאתר ונסו שוב.'
          : reason === 'popup-closed'
            ? 'חלון ההתחברות נסגר לפני שההתחברות הושלמה.'
            : 'ההתחברות נכשלה, נסו שוב.',
      );
      this.busy.set(false);
      return;
    }
    // Only follow app-internal relay targets. Navigation errors are left to the router's error handler.
    const relay = this.route.snapshot.queryParamMap.get('RelayState');
    this.router.navigateByUrl(relay?.startsWith('/') && !relay.startsWith('//') ? relay : '/summaries');
  }
}
