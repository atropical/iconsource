import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "figma-kit/styles.css";
import "./styles/icontopia.css";
import { PluginCommands, MessageTypes, PluginMessage, IconLibrary } from "./types.d";
import { LibrariesView } from "./views/LibrariesView";
import { LibraryDetailView } from "./views/LibraryDetailView";
import { UpdateView } from "./views/UpdateView";

const BrowseFlow: React.FC = () => {
    const [selected, setSelected] = useState<IconLibrary | null>(null);

    if (selected) {
        return <LibraryDetailView library={selected} onBack={() => setSelected(null)} />;
    }
    return <LibrariesView onSelect={setSelected} />;
};

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
            return <BrowseFlow />;
    }
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
