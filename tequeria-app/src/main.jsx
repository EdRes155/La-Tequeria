import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/figtree";
import "@fontsource-variable/bricolage-grotesque";
import App from "./App.jsx";

document.documentElement.style.height = "100%";
document.body.style.height = "100%";
document.body.style.margin = "0";
const el = document.getElementById("root");
el.style.height = "100%";
createRoot(el).render(<App />);
