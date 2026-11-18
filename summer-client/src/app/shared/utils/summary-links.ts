import { SummaryKind } from '../models';

/**
 * A summary's own full page (not the home page's side drawer): what opening it in a new tab or window shows. A running
 * summary has its own page; sumaroons are never placed in folders, so they don't come through here.
 */
export function summaryPageLink(item: { _id: string; kind: SummaryKind }): string[] {
  return item.kind === SummaryKind.Running ? ['/running', item._id] : ['/summaries', item._id];
}
