import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { StorageService } from '../../../core/storage/storage.service';
import { QueryService } from '../../../shared/services/query.service';
import { UserGroupService } from '../../../shared/services/user-group.service';
import { SavedSearchesComponent } from '../saved-searches/saved-searches.component';
import { UserGroupsComponent } from '../user-groups/user-groups.component';

type Tab = 'searches' | 'groups';

const STATE_KEY = 'profileShelf';
/** Lists longer than this get a filter box. */
const FILTER_FROM = 6;

/**
 * The own profile's shelf: saved searches and user groups as two tabs over one row of cards, with the active tab's
 * filter and "new" actions on the right. Collapsible; the tab and the collapsed state are remembered per browser.
 */
@Component({
  selector: 'app-profile-shelf',
  imports: [FormsModule, RouterLink, NzIconModule, NzInputModule, NzToolTipModule, SavedSearchesComponent, UserGroupsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-shelf.component.html',
  styleUrl: './profile-shelf.component.scss',
})
export class ProfileShelfComponent {
  private readonly storage = inject(StorageService);
  private readonly queries = inject(QueryService);
  private readonly groups = inject(UserGroupService);

  private readonly saved = this.storage.get<{ tab?: Tab; collapsed?: boolean }>(STATE_KEY) ?? {};
  readonly tab = signal<Tab>(this.saved.tab ?? 'searches');
  readonly collapsed = signal(this.saved.collapsed ?? false);
  readonly filter = signal('');

  readonly searchCount = computed(() => this.queries.queries().length);
  readonly groupCount = computed(() => this.groups.list()?.length ?? 0);
  readonly showFilter = computed(() => !this.collapsed() && (this.tab() === 'searches' ? this.searchCount() : this.groupCount()) > FILTER_FROM);

  private readonly userGroups = viewChild(UserGroupsComponent);

  constructor() {
    this.queries.ensureLoaded();
    this.groups.ensureLoaded();
    effect(() => this.storage.set(STATE_KEY, { tab: this.tab(), collapsed: this.collapsed() }));
  }

  select(tab: Tab) {
    if (this.tab() !== tab) this.filter.set('');
    this.tab.set(tab);
    this.collapsed.set(false);
  }

  newGroup() {
    this.userGroups()?.create();
  }

  browseSharedGroups() {
    this.userGroups()?.browseShared();
  }
}
