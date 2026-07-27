import {appConfigContext} from "../configuration/appConfigContext";

export const Logo = (props: any) => {
    return <img {...props} src={appConfigContext.defaultLogo} alt={appConfigContext.defaultTitle}/>
};
