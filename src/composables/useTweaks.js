import { reactive } from "vue";

export function useTweaks(defaults) {
  const values = reactive({ ...defaults });

  const setTweak = (keyOrEdits, val) => {
    const edits =
      typeof keyOrEdits === "object" && keyOrEdits !== null
        ? keyOrEdits
        : { [keyOrEdits]: val };

    Object.assign(values, edits);

    if (typeof window !== "undefined") {
      window.parent?.postMessage({ type: "__edit_mode_set_keys", edits }, "*");
      window.dispatchEvent(new CustomEvent("tweakchange", { detail: edits }));
    }
  };

  return [values, setTweak];
}
