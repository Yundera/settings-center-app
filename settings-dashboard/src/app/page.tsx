"use client";
import {AppLoader} from "@/core/AppLoader";
import {lazy} from "react";
import {getConfig} from "@/configuration/getConfigFrontEnd";
import {localAuthProvider} from "@/configuration/LocalAuthProvider";

const App = lazy(() => import("./pages/App"));// Lazy load App component

export default function Home() {
  return <AppLoader AppComponent={App} providers={async () => {
    const {appConfigContext} = await import("@/core/configuration/appConfigContext");
    const {multiDataProvider} = await import("@/core/interface/DataProvider");
    const {brandContext, loadBrand} = await import("@/core/configuration/brandContext");
    // Resolved here, inside the callback AppLoader awaits, so the whole app
    // tree sees settled branding at first render. Never throws.
    await loadBrand();
    const {brand} = brandContext.current;
    // brand.logo carries its own leading slash (enforced by LOGO_PATTERN), so
    // the base must NOT end in one: BASE_PATH is "/" in a local checkout, and
    // "/" + "/logo.svg" is a protocol-relative "//logo.svg" that resolves to a
    // different host. Stripping also fixes the old concatenation, which
    // produced "/adminlogo-…" when BASE_PATH was "/admin".
    const basePath = (getConfig("BASE_PATH") || "").replace(/\/$/, "");
    appConfigContext.defaultLogo = `${basePath}${brand.logo}`;
    appConfigContext.defaultTitle = brand.appTitle;
    return {
      authProvider: localAuthProvider,
      dataProvider: multiDataProvider,
    }
  }}/>;
}
