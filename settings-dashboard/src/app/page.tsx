"use client";
import {AppLoader} from "dashboard-core";
import {lazy} from "react";
import {getConfig} from "@/configuration/getConfigFrontEnd";
import {localAuthProvider} from "@/configuration/LocalAuthProvider";

const App = lazy(() => import("./pages/App"));// Lazy load App component

export default function Home() {
  return <AppLoader AppComponent={App} providers={async () => {
    const {
      appConfigContext,
      multiDataProvider} = await import("dashboard-core");
    const basePath = getConfig("BASE_PATH");
    appConfigContext.defaultLogo = `${basePath}logo-nasselle-V1.svg`;
    appConfigContext.defaultTitle = 'Settings';
    return {
      authProvider: localAuthProvider,
      dataProvider: multiDataProvider,
    }
  }}/>;
}
