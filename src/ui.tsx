import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "figma-kit/styles.css";
import { PluginCommands, MessageTypes, PluginMessage } from "./types.d";
import { BrowseView } from "./views/BrowseView";
import { UpdateView } from "./views/UpdateView";

const App: React.FC = () => {
    const [command, setCommand] = useState<PluginCommands>(PluginCommands.BROWSE);

    useEffect(() => {
        const handleMessage = ({ data: { pluginMessage } }: { data: { pluginMessage: PluginMessage } }) => {
            if (pluginMessage.type === MessageTypes.BASIC_INFO && pluginMessage.command) {
                setCommand(pluginMessage.command);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    switch (command) {
        case PluginCommands.CHECK_UPDATES:
            return <UpdateView />;
        case PluginCommands.BROWSE:
        default:
            return <BrowseView />;
    }
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
