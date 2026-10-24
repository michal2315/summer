import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzStepsModule } from 'ng-zorro-antd/steps';

/** /extension — what the companion browser extension does. */
@Component({
  selector: 'app-extension-details',
  imports: [RouterLink, NzButtonModule, NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <span nz-icon nzType="appstore-add" class="big"></span>
      <h1>שלחו לסאמר מכל אתר</h1>
      <p>התוסף לדפדפן מאפשר לסמן טקסט בכל דף — מאמר, הרצאה מוקלטת, ספר דיגיטלי — ולשלוח אותו ישירות כטיוטת סיכום, כולל הקישור למקור.</p>
      <a nz-button nzType="primary" routerLink="install"><span nz-icon nzType="download"></span> להתקנת התוסף</a>
    </section>
    <ul class="features">
      <li><span nz-icon nzType="highlight"></span><strong>סימון ושליחה</strong><span>מסמנים טקסט ולוחצים "שליחה לסאמר" בתפריט הקליק הימני.</span></li>
      <li><span nz-icon nzType="link"></span><strong>שמירת המקור</strong><span>כתובת הדף נשמרת בשדה "קישור" של הטיוטה.</span></li>
      <li><span nz-icon nzType="file-text"></span><strong>המשך עריכה כאן</strong><span>הטיוטה מחכה לכם בלשונית "טיוטות" בפרופיל.</span></li>
    </ul>
  `,
  styles: `
    :host { display: block; padding: 24px 18px; max-width: 820px; margin: 0 auto; }
    .hero { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; background: #fff; border-radius: 14px; padding: 28px 20px; }
    .big { font-size: 44px; color: #ff4056; }
    h1 { font-size: 22px; font-weight: 800; margin: 0; }
    p { max-width: 560px; color: #666; margin: 0; }
    .features { list-style: none; padding: 0; margin: 16px 0 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
    .features li { background: #fff; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .features [nz-icon] { font-size: 20px; color: #ff9155; }
  `,
})
export class ExtensionDetailsComponent {}

/** /extension/install — step-by-step install guide. */
@Component({
  selector: 'app-install-extension',
  imports: [RouterLink, NzButtonModule, NzIconModule, NzStepsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a routerLink="/extension" class="back"><span nz-icon nzType="arrow-right"></span> חזרה</a>
    <h1>התקנת התוסף</h1>
    <nz-steps nzDirection="vertical" [nzCurrent]="-1">
      <nz-step nzTitle="הורדה" nzDescription="פתחו את חנות התוספים של הדפדפן (Chrome / Edge) וחפשו Summer, או קבלו את הקישור מצוות התמיכה." />
      <nz-step nzTitle="הוספה לדפדפן" nzDescription="לחצו 'הוספה' ואשרו את ההרשאות — התוסף קורא רק את הטקסט שסימנתם." />
      <nz-step nzTitle="התחברות" nzDescription="בפעם הראשונה ששולחים טקסט, התוסף יבקש להתחבר עם חשבון האוניברסיטה." />
    </nz-steps>
  `,
  styles: `
    :host { display: block; padding: 24px 18px; max-width: 640px; margin: 0 auto; }
    .back { font-size: 13px; color: #666; }
    h1 { font-size: 20px; font-weight: 800; margin: 6px 0 16px; }
  `,
})
export class InstallExtensionComponent {}
