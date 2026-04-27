import {routes} from "./Routes";
import {resourceName} from "./Constant";
import {customEnglishMessages} from "./i18n/en";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {PanelInterface} from "dashboard-core";

export const systemInformationPanel: PanelInterface = {
    name: resourceName,
    route: {
        routes
    },
    i18n: {
        en: customEnglishMessages,
    },
    resource: {
        name: resourceName
    },
    icon: InfoOutlinedIcon
};
