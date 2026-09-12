import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ProductSite } from "./ProductSite";
import "./styles.css";

const normalizedPath = window.location.pathname.replace(/\/$/, "") || "/";
if (["/admin", "/space", "/ueberfuehren"].includes(normalizedPath)) {
  window.history.replaceState({}, "", "/login");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {normalizedPath === "/" ? <ProductSite/> : <App/>}
  </StrictMode>,
);
