import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ProductSite } from "./ProductSite";
import { identityCallbackKind } from "./identityFeedback";
import "./styles.css";

const normalizedPath = window.location.pathname.replace(/\/$/, "") || "/";
if (["/admin", "/space", "/ueberfuehren"].includes(normalizedPath)) {
  window.history.replaceState({}, "", `/login${window.location.search}${window.location.hash}`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {normalizedPath === "/" && !identityCallbackKind(window.location.hash) ? <ProductSite/> : <App/>}
  </StrictMode>,
);
