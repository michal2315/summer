import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { ALT_KEYS } from '../alt-keys';
import { AltKeysService } from '../alt-keys.service';

const GROUPS = Object.values(ALT_KEYS).reduce<{ name: string; items: { key: string; label: string }[] }[]>((groups, s) => {
  const g = groups.find((x) => x.name === s.group) ?? groups[groups.push({ name: s.group, items: [] }) - 1];
  g.items.push({ key: s.key, label: s.label });
  return groups;
}, []);

/** Rendered once in the app root: the key badges while Alt is held, and the Alt+/ shortcut list. */
@Component({
  selector: 'app-alt-overlay',
  imports: [NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alt-overlay.component.html',
  styleUrl: './alt-overlay.component.scss',
})
export class AltOverlayComponent {
  readonly keys = inject(AltKeysService);
  readonly groups = GROUPS;

  /** 'Shift+X' → ['Alt', 'Shift', 'X'] */
  parts(key: string): string[] {
    return ['Alt', ...key.split('+')];
  }
}
