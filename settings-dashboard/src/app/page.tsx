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
    const basePath = getConfig("BASE_PATH");
    appConfigContext.defaultLogo = `${basePath}logo-nasselle-V1.svg`;
    appConfigContext.defaultTitle = 'Settings';
    return {
      authProvider: localAuthProvider,
      dataProvider: multiDataProvider,
    }
  }}/>;
}
