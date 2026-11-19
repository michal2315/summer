import { Injectable, computed, inject, signal } from '@angular/core';
import { UserService } from '../auth/user.service';
import { UserPreferences } from '../../shared/models';

/** What each preference is when the user hasn't set it. */
export const PREFERENCE_DEFAULTS: Required<UserPreferences> = {
  folderSearch: 'keep',
  dates: 'relative',
};

/** The user's preferences with the defaults filled in. They live on the user (server), so they follow the user. */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly users = inject(UserService);

  readonly all = computed<Required<UserPreferences>>(() => ({ ...PREFERENCE_DEFAULTS, ...this.users.user()?.preferences }));
  /** Moving to another folder keeps the current search (or drops it). */
  readonly keepSearchAcrossFolders = computed(() => this.all().folderSearch === 'keep');
  /** Times as the date and hour instead of "3 hours ago". */
  readonly exactDates = computed(() => this.all().dates === 'exact');
  /**
   * Demo switch, not saved: small sumaroons (only a date, a link and content of their own; everything else comes from
   * the running summary) instead of full ones. Turned on again on every load.
   */
  readonly liteSumaroons = signal(true);

  set(patch: UserPreferences) {
    return this.users.setPreferences(patch);
  }
}
