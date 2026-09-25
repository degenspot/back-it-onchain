export type UserRole = 'ADMIN' | 'ORACLE' | 'PAUSER' | 'USER';

export interface UserAuthContext {
  userId: string;
  roles: UserRole[];
}

export function validateUserRole(context: UserAuthContext, requiredRole: UserRole): boolean {
  if (!context || !context.roles) return false;
  return context.roles.includes(requiredRole);
}
