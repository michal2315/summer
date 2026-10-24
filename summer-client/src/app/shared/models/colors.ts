/** Summary color palette — mirrors $summary-colors. '' means uncolored. */
export const SUMMARY_COLORS = ['#fe9eae', '#ff0000', '#ffa500', '#008000', '#00b2b2', '#0000c9', '#800080', '#808080'] as const;

export const colorGlow = (color: string | undefined) => (color ? `0 3px 10px ${color}40` : 'none');
