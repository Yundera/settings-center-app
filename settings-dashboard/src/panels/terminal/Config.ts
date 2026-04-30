import {routes} from "./Routes";
import {resourceName} from "./Constant";
import {customEnglishMessages} from "./i18n/en";
import TerminalIcon from "@mui/icons-material/Terminal";
import {PanelInterface} from "dashboard-core";

export const terminalPanel:PanelInterface = {
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
    icon: TerminalIcon
};
