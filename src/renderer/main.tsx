import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Palette from "./Palette";

// The same bundle renders the library window and the inline paste menu (#palette).
const isPalette = window.location.hash === "#palette";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isPalette ? <Palette /> : <App />}</React.StrictMode>,
);
