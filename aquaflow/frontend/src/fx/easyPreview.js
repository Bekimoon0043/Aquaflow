import { createFullShowPreview } from "../utils/fullShowPreview";
import { useICANPreviewStore } from "../store/icanPreviewStore";

export function loadEasyFountainPreview(result) {
  if (!result?.engineering?.fixtures?.length) throw new Error("Build a fountain before opening the preview.");
  const clips = result.timelineTracks.flatMap(track => track.clips || []);
  const preview = createFullShowPreview(clips, result.engineering.fixtures, `${result.currentShow.name} · 3D preview`);
  useICANPreviewStore.getState().load(preview, 1, null, "preview");
  return preview;
}
