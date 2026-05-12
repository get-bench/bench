import { Outlet } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { usePermissions } from "../../hooks/usePermissions";

/**
 * Route gate for the `/bench/settings/*` Instance settings area. Renders the
 * outlet only when the signed-in user is an instance admin (or the local
 * single-tenant boot mode that's owner-equivalent). Non-admins see a friendly
 * 403 page instead of a confusing partial render or raw API failure.
 *
 * The instance-admin pages also gate every endpoint they call on the server
 * (`assertInstanceAdmin` in `routes/authz.ts`); this guard is just so users
 * who follow a deep link don't see broken settings forms.
 */
export function InstanceAdminGuard() {
  const { isLoading, boardAccess, isInstanceAdmin } = usePermissions(null);

  if (isLoading || !boardAccess) {
    return (
      <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!isInstanceAdmin) {
    return <InstanceSettingsForbidden />;
  }

  return <Outlet />;
}

function InstanceSettingsForbidden() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Instance settings are admin-only</h1>
      <p className="text-sm text-muted-foreground">
        Bench instance settings — SSO, plugins, adapters, and instance access
        — can only be changed by an instance admin. Ask whoever set up this
        Bench instance to grant you access from{" "}
        <span className="font-medium">Bench settings → Access</span>, or open a
        workspace from the home page instead.
      </p>
      <div className="mt-2 flex justify-center">
        <Button asChild variant="outline">
          <a href="/">Back to home</a>
        </Button>
      </div>
    </div>
  );
}
