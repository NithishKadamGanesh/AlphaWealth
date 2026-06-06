import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import App from "./App";
import { installFetchAuth } from "./lib/api";

// Inject the API token (if configured in Settings) into all backend requests.
installFetchAuth();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
