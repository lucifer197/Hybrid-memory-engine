export interface PrivacyContext {
  tenantId: string;
  workspaceId: string;
  userId: string;
}

/**
 * Build a SQL WHERE clause fragment enforcing privacy_scope rules.
 *
 * Since every query already filters by tenant_id + workspace_id:
 *   - 'tenant' scope: visible to all users in the tenant (passes automatically)
 *   - 'workspace' scope: visible to all users in the workspace (passes automatically)
 *   - 'private' scope: only the creating user_id can see it
 *
 * This simplifies to: (privacy_scope != 'private' OR user_id = $N)
 */
export function buildPrivacyScopeClause(
  ctx: PrivacyContext,
  tableAlias: string,
  paramStartIdx: number
): { clause: string; params: unknown[]; nextParamIdx: number } {
  const clause = `(${tableAlias}.privacy_scope != 'private' OR ${tableAlias}.user_id = $${paramStartIdx})`;
  return {
    clause,
    params: [ctx.userId],
    nextParamIdx: paramStartIdx + 1,
  };
}
