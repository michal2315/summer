import { FieldsType, NotificationsFunctionsOptions as F } from '../../shared/models';
import { describeRule } from './notification-rules';

describe('rule descriptions', () => {
  const field = { _id: 'f', name: 'שם הקורס', type: FieldsType.String };
  const conditions = [
    { field, funcName: F.StringContains, content: ['גרפים'] },
    { field, funcName: F.CapsuleMatches, content: ['cap-trees', 'עצים'] },
  ];

  it('joins conditions with וגם, or with או for any-of rules, and names capsules', () => {
    expect(describeRule({ conditions })).toBe('שם הקורס מכיל "גרפים" וגם שם הקורס תואם לכמוסה #עצים');
    expect(describeRule({ conditions, matchAny: true })).toBe('שם הקורס מכיל "גרפים" או שם הקורס תואם לכמוסה #עצים');
  });

  it('describes a search alert by its search', () => {
    expect(describeRule({ conditions: [], search: { text: 'גרף' } })).toBe('תמציות שמתאימות לחיפוש: גרף');
  });
});
