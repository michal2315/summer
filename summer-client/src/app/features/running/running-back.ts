import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Where "back" on a running summary page goes: the page the user came from (feed, search, profile…), captured on
 * entry. Moving around inside the running summary (opening sumaroons, full screen and back) doesn't overwrite it.
 */
@Injectable({ providedIn: 'root' })
export class RunningBackService {
  private readonly router = inject(Router);
  private readonly targets = new Map<string, string>();

  /** Call when a running summary page opens. */
  remember(runningId: string) {
    const previous = this.router.lastSuccessfulNavigation?.previousNavigation?.finalUrl;
    const url = previous ? this.router.serializeUrl(previous) : null;
    if (url && !url.startsWith(`/running/${runningId}`)) this.targets.set(runningId, url);
  }

  back(runningId: string) {
    this.router.navigateByUrl(this.targets.get(runningId) ?? '/summaries');
  }
}
