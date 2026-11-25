import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BgOverlayToast } from "./components/overlay/BgOverlayToast";
import "./index.css";

const isOverlayWindow =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("overlay") === "1";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isOverlayWindow ? <BgOverlayToast /> : <App />}
  </React.StrictMode>
);
