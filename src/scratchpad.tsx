import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { Scratchpad } from "./components/Scratchpad";
import { ScratchpadTheme } from "./components/ScratchpadTheme";
import "./styles.css";
import "./scratchpad.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ScratchpadTheme />
    <Scratchpad />
  </React.StrictMode>
);
