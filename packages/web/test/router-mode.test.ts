import { describe, expect, it } from "vitest";
import {
  appRouteHref,
  appRouteUrl,
  browserRouterMode,
  hashHrefForLegacyLocation,
} from "../src/lib/router-mode";

describe("router mode compatibility", () => {
  it("uses hash routing only when explicitly requested", () => {
    expect(browserRouterMode(undefined)).toBe("browser");
    expect(browserRouterMode("")).toBe("browser");
    expect(browserRouterMode("browser")).toBe("browser");
    expect(browserRouterMode("hash")).toBe("hash");
    expect(browserRouterMode(" HASH ")).toBe("hash");
  });

  it("builds a hash URL once from a legacy pathname and query", () => {
    expect(hashHrefForLegacyLocation("/", "")).toBeNull();
    expect(hashHrefForLegacyLocation("/chat/session-1", "?panel=files")).toBe(
      "/#/chat/session-1?panel=files",
    );
    expect(hashHrefForLegacyLocation("/", "?next=%2Fchat")).toBe("/#/?next=%2Fchat");
  });

  it("reads and rebuilds the router URL inside the fragment", () => {
    const href = "http://example.test/#/terminal?cwd=%2Ftmp&name=dev";
    expect(appRouteUrl(href, "hash").pathname).toBe("/terminal");
    expect(appRouteUrl(href, "hash").searchParams.get("cwd")).toBe("/tmp");

    const route = appRouteUrl(href, "hash");
    route.hash = "";
    route.searchParams.set("id", "term-1");
    expect(appRouteHref(route, href, "hash")).toBe(
      "http://example.test/#/terminal?cwd=%2Ftmp&name=dev&id=term-1",
    );
  });

  it("leaves ordinary browser-history URLs unchanged", () => {
    const href = "http://example.test/terminal?cwd=%2Ftmp";
    expect(appRouteUrl(href, "browser").href).toBe(href);
    expect(appRouteHref(new URL("http://example.test/terminal?id=term-1"), href, "browser")).toBe(
      "http://example.test/terminal?id=term-1",
    );
  });
});
