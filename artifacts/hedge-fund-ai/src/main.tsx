import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setBaseUrl } from "@workspace/api-client-react";

const isReplitOrLocal =
  window.location.hostname.endsWith(".replit.app") ||
  window.location.hostname.endsWith(".replit.dev") ||
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

if (!isReplitOrLocal) {
  setBaseUrl("https://ai-bitda.replit.app");
}

createRoot(document.getElementById("root")!).render(<App />);
