/**
 * Dev/test identity directory: stands in for the university SSO + AD/People API until their contracts are supplied.
 * `groups` are external group keys (permissions.group_name). Used by DevIdentityProvider and the seed.
 */
export interface DevIdentity {
  username: string;
  fullName: string;
  department: string;
  email: string;
  groups: string[];
  isSystem?: boolean;
}

const mail = (u: string) => `${u}@example-university.edu`;

export const DEV_IDENTITIES: DevIdentity[] = [
  { username: 'summer', fullName: 'Summer', department: 'מערכת', email: mail('summer'), groups: [], isSystem: true },
  { username: 'mgolan', fullName: 'מיכל גולן', department: 'מדעי המחשב', email: mail('mgolan'), groups: ['cs-faculty', 'math-faculty', 'year-1', 'staff'] },
  { username: 'dlevi', fullName: 'דנה לוי', department: 'מדעי המחשב', email: mail('dlevi'), groups: ['cs-faculty', 'year-1'] },
  { username: 'yavraham', fullName: "פרופ' יוסי אברהם", department: 'מתמטיקה', email: mail('yavraham'), groups: ['math-faculty', 'staff'] },
  { username: 'nmizrahi', fullName: 'נועה מזרחי', department: 'מדעי ההתנהגות', email: mail('nmizrahi'), groups: ['behavioral', 'year-1'] },
  { username: 'aperetz', fullName: 'אורי פרץ', department: 'מדעי המחשב', email: mail('aperetz'), groups: ['cs-faculty', 'year-1'] },
  { username: 'sbiton', fullName: 'שירה ביטון', department: 'מתמטיקה', email: mail('sbiton'), groups: ['math-faculty', 'year-1'] },
  { username: 'efriedman', fullName: 'איתי פרידמן', department: 'מדעי המחשב', email: mail('efriedman'), groups: ['cs-faculty'] },
];

export const DEV_ISSUER = 'dev';
