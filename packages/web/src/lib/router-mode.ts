/** Browser-history routing is the product default; hash routing is an explicit compatibility build. */
export type BrowserRouterMode = "browser" | "hash";

export function browserRouterMode(value: string | undefined): BrowserRouterMode {
  return value?.trim().toLowerCase() === "hash" ? "hash" : "browser";
}

export const ROUTER_MODE = browserRouterMode(import.meta.env.VITE_ROUTER_MODE);

/**
 * A legacy address-bar URL is moved under the fragment before the hash router is created, so a
 * direct link such as `/chat/session-1?panel=files` keeps its route instead of falling back to
 * `/chat`.
 */
export function hashHrefForLegacyLocation(pathname: string, search: string): string | null {
  if ((pathname === "/" || pathname === "") && search === "") return null;
  return `/#${pathname || "/"}${search}`;
}

export function migrateLegacyHashLocation(): void {
  if (ROUTER_MODE !== "hash" || window.location.hash !== "") return;
  const href = hashHrefForLegacyLocation(window.location.pathname, window.location.search);
  if (href !== null) window.history.replaceState(window.history.state, "", href);
}

/** The route URL represented by the address bar, whether it lives before or after `#`. */
export function appRouteUrl(href: string, mode: BrowserRouterMode = ROUTER_MODE): URL {
  const url = new URL(href);
  if (mode === "browser") return url;
  return new URL(url.hash.startsWith("#") ? url.hash.slice(1) || "/" : "/", url.origin);
}

/** Rebuild a full address-bar URL after changing an app-route URL. */
export function appRouteHref(
  route: URL,
  currentHref: string,
  mode: BrowserRouterMode = ROUTER_MODE,
): string {
  if (mode === "browser") return route.href;
  const current = new URL(currentHref);
  return `${current.origin}${current.pathname}${current.search}#${route.pathname}${route.search}`;
}
