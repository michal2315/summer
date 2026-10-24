/** What a verified bearer token tells us. Groups are authoritative external keys (never client-supplied). */
export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  username: string;
  fullName: string;
  department: string;
  email?: string;
  isSystem?: boolean;
  groupKeys: string[];
}

/**
 * Adapter boundary for the university SSO + group directory (handoff §3). Implementations verify a token
 * and resolve the user's current groups; they return null for anything not provably valid.
 */
export abstract class IdentityProvider {
  abstract verify(token: string): Promise<VerifiedIdentity | null>;
}

/** The authenticated caller, attached to every request by AuthGuard. */
export interface CurrentUser {
  id: string;
  username: string;
  fullName: string;
  department: string;
  isSystem: boolean;
  groupKeys: string[];
  /** Summer permission ids the caller holds (mapped from groupKeys). */
  permissionIds: string[];
}
