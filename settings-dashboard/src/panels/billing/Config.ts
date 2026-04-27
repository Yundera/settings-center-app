import {routes} from "./Routes";
import {resourceName} from "./Constant";
import {customEnglishMessages} from "./i18n/en";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import {PanelInterface} from "dashboard-core";

export const billingPanel: PanelInterface = {
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
    icon: ReceiptLongIcon
};
