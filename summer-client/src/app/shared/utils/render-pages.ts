import { Signal, computed, linkedSignal } from '@angular/core';

export interface RenderPages<T> {
  /** The items rendered so far. */
  readonly items: Signal<T[]>;
  readonly hasMore: Signal<boolean>;
  /** Render the next page (call from an appInView sentinel after the list). */
  more(): void;
}

/**
 * Infinite scroll over a list that is already in memory: renders the first `pageSize` items and another page on
 * each `more()`. Goes back to the first page whenever `resetOn` changes (a new filter, a fresh fetch); patches to the
 * source in between keep what has been rendered.
 */
export function renderPages<T>(source: () => readonly T[], pageSize = 30, resetOn: () => unknown = () => null): RenderPages<T> {
  const limit = linkedSignal({ source: resetOn, computation: () => pageSize });
  return {
    items: computed(() => source().slice(0, limit())),
    hasMore: computed(() => source().length > limit()),
    more: () => limit.update((n) => n + pageSize),
  };
}
