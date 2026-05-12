import {routes} from "./Routes";
import {resourceName} from "./Constant";
import {customEnglishMessages} from "./i18n/en";
import SpeedIcon from "@mui/icons-material/Speed";
import {PanelInterface} from "dashboard-core";

export const perfPanel:PanelInterface = {
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
    icon: SpeedIcon
};
