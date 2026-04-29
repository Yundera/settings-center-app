import {routes} from "./Routes";
import {resourceName} from "./Constant";
import {customEnglishMessages} from "./i18n/en";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import {PanelInterface} from "dashboard-core";

export const accessPanel:PanelInterface = {
    name: resourceName,
    route: {
        routes
    },
    i18n: {
        en: customEnglishMessages,
    },
    resource:{
        name: resourceName
    },
    icon: VpnKeyIcon
};
