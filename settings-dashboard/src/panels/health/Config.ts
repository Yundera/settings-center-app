import {routes} from "./Routes";
import {resourceName} from "./Constant";
import {customEnglishMessages} from "./i18n/en";
import DeveloperBoardIcon from "@mui/icons-material/DeveloperBoard";
import {PanelInterface} from "dashboard-core";

export const healthPanel:PanelInterface = {
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
    icon: DeveloperBoardIcon
};
