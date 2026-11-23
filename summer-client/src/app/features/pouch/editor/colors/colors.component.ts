import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Word's theme-ish palette: a row of strong colours, then lighter and darker shades. */
const PALETTE = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
];

/** A colour grid for the ribbon's text, highlight and cell colours; the first button clears the colour. */
@Component({
  selector: 'app-pouch-colors',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './colors.component.html',
  styleUrl: './colors.component.scss',
})
export class PouchColorsComponent {
  /** The clear button's text ("automatic" for text, "no colour" for fills). */
  readonly noneLabel = input('ללא צבע');
  readonly current = input('');
  readonly pick = output<string>();
  readonly rows = PALETTE;
}
