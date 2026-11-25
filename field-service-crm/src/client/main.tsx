import { render } from "preact";
import { App } from "./app";
import { prepareOfflineSupport } from "./offline";
import "./tokens.css";
import "./styles.css";
import "./crm/crm.css";

void prepareOfflineSupport();
render(<App />, document.getElementById("app")!);
