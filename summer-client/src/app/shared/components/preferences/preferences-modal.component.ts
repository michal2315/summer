import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { format } from 'date-fns';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzRadioModule } from 'ng-zorro-antd/radio';
import { PreferencesService } from '../../../core/preferences/preferences.service';
import { UserPreferences } from '../../models';

/** The personal preferences dialog. Each change is saved right away. */
@Component({
  selector: 'app-preferences-modal',
  imports: [FormsModule, NzIconModule, NzRadioModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './preferences-modal.component.html',
  styleUrl: './preferences-modal.component.scss',
})
export class PreferencesModalComponent {
  readonly prefs = inject(PreferencesService);
  private readonly message = inject(NzMessageService);

  /** Three hours ago, as an exact date reads. */
  readonly example = format(Date.now() - 3 * 3600_000, 'dd/MM/yyyy HH:mm');

  /** The preference being saved. */
  readonly saving = signal<keyof UserPreferences | null>(null);

  change<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    this.saving.set(key);
    this.prefs.set({ [key]: value }).subscribe({
      next: () => {
        this.saving.set(null);
        this.message.success('ההעדפה נשמרה');
      },
      error: () => this.saving.set(null),
    });
  }
}
