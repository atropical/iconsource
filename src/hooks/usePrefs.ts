import { useCallback, useEffect, useState } from "react";
import { IconsourcePrefs, MessageTypes, PluginMessage } from "../types.d";

/**
 * Persisted sort/filter prefs, backed by figma.clientStorage on the main
 * thread (the UI iframe has no durable storage of its own). Each view that
 * uses this gets its own round-trip on mount — cheap, and simpler than
 * threading a shared cache through views that are never mounted together.
 */
export function usePrefs() {
  const [prefs, setPrefs] = useState<IconsourcePrefs>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const handler = ({ data: { pluginMessage } }: { data: { pluginMessage: PluginMessage } }) => {
      if (pluginMessage.type === MessageTypes.PREFS_GET_RESULT) {
        setPrefs(pluginMessage.prefs ?? {});
        setLoaded(true);
      }
    };
    window.addEventListener("message", handler);
    parent.postMessage({ pluginMessage: { type: MessageTypes.PREFS_GET_REQUEST } as PluginMessage }, "*");
    return () => window.removeEventListener("message", handler);
  }, []);

  const setPref = useCallback(<K extends keyof IconsourcePrefs>(key: K, value: IconsourcePrefs[K]) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    parent.postMessage({ pluginMessage: { type: MessageTypes.PREFS_SET_REQUEST, prefs: { [key]: value } } as PluginMessage }, "*");
  }, []);

  return { prefs, loaded, setPref };
}
