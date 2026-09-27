import React from "react";
import ReactDOM from "react-dom/client";

import "../index.css";
import { MobileChatQaHarness } from "./MobileChatQaHarness";

const el = document.getElementById("root");
if (el) {
  ReactDOM.createRoot(el).render(
    <React.StrictMode>
      <MobileChatQaHarness />
    </React.StrictMode>,
  );
}
