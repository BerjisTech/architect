import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, RouterStateSnapshot } from '@angular/router';
import { CoreAuthService, redirectToCentralLogin } from '@berjis/angular-auth';

@Injectable({ providedIn: 'root' })
export class EnsureAuthGuard implements CanActivate {
  constructor(private auth: CoreAuthService) {}

  async canActivate(_route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Promise<boolean> {
    const session = await this.auth.ensureAuth({ maxAgeMs: 1500 });
    if (!session.valid) {
      redirectToCentralLogin(state.url);
      return false;
    }
    return true;
  }
}
