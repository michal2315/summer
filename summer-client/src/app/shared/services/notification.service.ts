import { HttpClient, HttpContext } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, filter, fromEvent, startWith, switchMap, timer } from 'rxjs';
import { APP_CONFIG } from '../../core/config/app-config';
import { SILENT_ERRORS } from '../../core/http/http-context';
import { INotification } from '../models';

const BASE = '/api/notifications';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(APP_CONFIG);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _items = signal<INotification[]>([]);
  private started = false;

  readonly items = this._items.asReadonly();
  private readonly _loaded = signal(false);
  /** The first poll has answered (or failed). */
  readonly loaded = this._loaded.asReadonly();
  readonly unread = computed(() => this._items().filter((n) => !n.isViewed).length);

  /** Poll every notificationsPollMs while the tab is visible; refetch immediately when it becomes visible again. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const visible$ = fromEvent(document, 'visibilitychange').pipe(startWith(null));
    visible$
      .pipe(
        switchMap(() => (document.hidden ? EMPTY : timer(0, this.config.notificationsPollMs))),
        switchMap(() =>
          this.http.get<INotification[]>(BASE, { context: new HttpContext().set(SILENT_ERRORS, true) }).pipe(
            catchError(() => {
              this._loaded.set(true);
              return EMPTY;
            }),
          ),
        ),
        filter(Array.isArray),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((items) => {
        this._items.set(items);
        this._loaded.set(true);
      });
  }

  markViewed(id: string): void {
    this._items.update((items) => items.map((n) => (n._id === id ? { ...n, isViewed: true } : n)));
    this.http.put(`${BASE}/viewed/${id}`, {}).subscribe();
  }

  markAllViewed(): void {
    this._items.update((items) => items.map((n) => ({ ...n, isViewed: true })));
    this.http.put(`${BASE}/all-viewed`, {}).subscribe();
  }
}
