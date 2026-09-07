import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { Component } from "react";
import { WebSocketProvider } from "./hooks/WebSocketContext";
import { useAutoSave } from "./hooks/useAutoSave";
import { useServerShowSync } from "./hooks/useServerShowSync";
import TopBar from "./components/TopBar";
import NodeEditor from "./components/nodes/NodeEditor";
import Timeline from "./components/timeline/Timeline";
import DevicePanel from "./components/panels/DevicePanel";
import InspectorPanel from "./components/panels/InspectorPanel";
// AQ-FIX-002 — panels are route-level code-split: each is a lazy() chunk fetched
// only when its panel is first opened, so heavy panels (preview/three.js,
// geometry designer, show programmer, fixture library) stay out of the initial
// bundle. The switch below is wrapped in a single <Suspense> boundary.
const PreviewPanel = lazy(() => import("./components/preview/PreviewPanel_v5"));
const AIPanel = lazy(() => import("./components/panels/AIPanel"));
const DeviceDiscoveryPanel = lazy(() => import("./components/panels/DeviceDiscoveryPanel"));
const AudioPanel = lazy(() => import("./components/panels/AudioPanel"));
const PLCPanel = lazy(() => import("./components/panels/PLCPanel"));
const SchedulerPanel = lazy(() => import("./components/panels/SchedulerPanel"));
const SafetyMonitorPanel = lazy(() => import("./components/panels/SafetyMonitorPanel"));
const OperatorPanel = lazy(() => import("./components/panels/OperatorPanel"));
const DiagnosticsPanel = lazy(() => import("./components/panels/DiagnosticsPanel"));
const DependencyGraphPanel = lazy(() => import("./components/panels/DependencyGraphPanel"));
const RealtimeValidationPanel = lazy(() => import("./components/panels/RealtimeValidationPanel"));
const WindDriftPanel = lazy(() => import("./components/panels/WindDriftPanel"));
const EngineeringToolsPanel = lazy(() => import("./components/panels/EngineeringToolsPanel"));
const MobileMonitorPanel = lazy(() => import("./components/panels/MobileMonitorPanel"));
const CollaborationPanel = lazy(() => import("./components/panels/CollaborationPanel"));
const EnvironmentMaterialPanel = lazy(() => import("./components/panels/EnvironmentMaterialPanel"));
const TrainingAcademyPanel = lazy(() => import("./components/panels/TrainingAcademyPanel"));
const DocumentationPanel = lazy(() => import("./components/panels/DocumentationPanel"));
const DigitalTwinPanel = lazy(() => import("./components/panels/DigitalTwinPanel"));
const OptimizationPanel = lazy(() => import("./components/panels/OptimizationPanel"));
const AdaptationPanel = lazy(() => import("./components/panels/AdaptationPanel"));
const FleetPanel = lazy(() => import("./components/panels/FleetPanel"));
const CloudPanel = lazy(() => import("./components/panels/CloudPanel"));
const GenerativeDesignerPanel = lazy(() => import("./components/panels/GenerativeDesignerPanel"));
const CompilePanel = lazy(() => import("./components/panels/CompilePanel"));
const PresetBrowser = lazy(() => import("./components/panels/PresetBrowser"));
const CalibrationPanel = lazy(() => import("./components/panels/CalibrationPanel"));
const KeyframeEditor = lazy(() => import("./components/timeline/KeyframeEditor"));
const PoolGeometryDesigner = lazy(() => import("./components/panels/PoolGeometryDesigner"));
const PatternDesignerPanel = lazy(() => import("./components/panels/PatternDesignerPanel"));
const Export3DPanel = lazy(() => import("./components/panels/Export3DPanel"));
const ShowProgrammerPanel = lazy(() => import("./components/programmer/ShowProgrammerPanel"));
const FountainControlPanel = lazy(() => import("./components/panels/FountainControlPanel"));
import ResizeHandle from "./components/layout/ResizeHandle";
import { useResizableLayout } from "./components/layout/useResizableLayout";
import StatusBar from "./components/StatusBar";
import ConnectionBanner from "./components/ConnectionBanner";
import CommissioningBanner from "./components/CommissioningBanner";
import LogPanel from "./components/LogPanel";
import ShowBrowser from "./components/ShowBrowser";
import { useShowStore } from "./store/showStore";
import "./styles/globals.css";



function StudioApp() {
  // Panel sizes are now draggable and persisted, rather than the frozen literal this
  // used to be. Defaults are unchanged (260 / 300 / 280), so a first run looks identical.
  const { layout, resize, beginDrag, endDrag, resetPanel } = useResizableLayout();
  // Measured at drag time so a panel can never be dragged wide enough to collapse the
  // centre workspace — the limit depends on the current window, not on a fixed constant.
  const workspaceRef = useRef(null);
  const centerRef = useRef(null);
  const workspacePx = () => workspaceRef.current?.clientWidth || 0;
  const centerHeightPx = () => centerRef.current?.clientHeight || 0;
  const [activePanel, setActivePanel] = useState("nodes");
  // AF-DISC — Device Discovery can hand the operator to the PLC panel (with a
  // prefill) or to Fountain Control. Navigation only: nothing connects or arms.
  useEffect(() => {
    const onOpen = (e) => { if (e?.detail?.panel) setActivePanel(e.detail.panel); };
    window.addEventListener("aquaflow:open-panel", onOpen);
    return () => window.removeEventListener("aquaflow:open-panel", onOpen);
  }, []);
  const [showLogs, setShowLogs] = useState(false);
  const [showBrowser, setShowBrowser] = useState(null);
  const { isDirty } = useShowStore();
  const { lastSaved } = useAutoSave();
  useServerShowSync();

  return (
    <div className="app-shell">
      {/* AF-HUB-000C — persistent "simulated output only" banner until hardware is commissioned. */}
      <CommissioningBanner />
      <ConnectionBanner />
      <TopBar
        activePanel={activePanel}
        setActivePanel={setActivePanel}
        onToggleLogs={() => setShowLogs((v) => !v)}
        onOpenBrowser={(mode) => setShowBrowser(mode)}
        isDirty={isDirty}
        lastSaved={lastSaved}
      />
      <div className={`workspace${activePanel === "geometry" ? " engineering-workspace" : ""}`} ref={workspaceRef}>
        {activePanel === "geometry" ? (
          <div className="engineering-workspace-content">
            <Suspense fallback={<div style={{ padding: 24, color: "var(--text-muted)", fontSize: 12 }}>Loading…</div>}>
              <PoolGeometryDesigner />
            </Suspense>
          </div>
        ) : (<>
        <DevicePanel width={layout.leftWidth} />
        <ResizeHandle
          axis="x"
          title="Drag to resize the device panel · double-click to reset"
          onStart={() => beginDrag("leftWidth")}
          onEnd={endDrag}
          onReset={() => resetPanel("leftWidth")}
          onResize={(d) => resize("leftWidth", d, {
            containerPx: workspacePx(), otherPanelsPx: layout.rightWidth,
          })}
        />
        <div className="center-stack" ref={centerRef}>
          <div className="editor-area">
           <Suspense fallback={<div style={{ padding: 24, color: "var(--text-muted)", fontSize: 12 }}>Loading…</div>}>
            {activePanel === "nodes"        && <NodeEditor />}
            {activePanel === "preview"      && <PreviewPanel />}
            {activePanel === "ai"           && <AIPanel />}
            {activePanel === "devices"      && <DeviceDiscoveryPanel />}
            {activePanel === "fountain"     && <FountainControlPanel />}
            {activePanel === "audio"        && <AudioPanel />}
            {activePanel === "plc"          && <PLCPanel />}
            {activePanel === "scheduler"    && <SchedulerPanel />}
            {activePanel === "safety"       && <SafetyMonitorPanel />}
            {activePanel === "operator"     && <OperatorPanel />}
            {activePanel === "diagnostics"  && <DiagnosticsPanel />}
            {activePanel === "dependencies" && <DependencyGraphPanel />}
            {activePanel === "validation"   && <RealtimeValidationPanel />}
            {activePanel === "wind"         && <WindDriftPanel />}
            {activePanel === "engtools"     && <EngineeringToolsPanel />}
            {activePanel === "mobilemon"    && <MobileMonitorPanel />}
            {activePanel === "collab"       && <CollaborationPanel />}
            {activePanel === "envmaterial"  && <EnvironmentMaterialPanel />}
            {activePanel === "academy"      && <TrainingAcademyPanel />}
            {activePanel === "docs"         && <DocumentationPanel />}
            {activePanel === "twin"         && <DigitalTwinPanel />}
            {activePanel === "optimize"     && <OptimizationPanel />}
            {activePanel === "adaptation"   && <AdaptationPanel />}
            {activePanel === "fleet"        && <FleetPanel />}
            {activePanel === "cloud"        && <CloudPanel />}
            {activePanel === "generative"   && <GenerativeDesignerPanel />}
            {activePanel === "compile"      && <CompilePanel />}
            {activePanel === "presets"      && <PresetBrowser />}
            {activePanel === "calibration"  && <CalibrationPanel />}
            {activePanel === "keyframes"    && <KeyframeEditor durationMs={8000} />}
            {activePanel === "patterns" && <PatternDesignerPanel />}
            {activePanel === "show_programmer" && <ShowProgrammerPanel />}
            {activePanel === "export3d"     && <Export3DPanel />}
           </Suspense>
          </div>
          <ResizeHandle
            axis="y"
            title="Drag to resize the timeline · double-click to reset"
            onStart={() => beginDrag("timelineHeight")}
            onEnd={endDrag}
            onReset={() => resetPanel("timelineHeight")}
            // Inverted: the handle sits on the timeline's TOP edge, so dragging down
            // must make it shorter, not taller.
            onResize={(d) => resize("timelineHeight", d, {
              invert: true, containerPx: centerHeightPx(), otherPanelsPx: 0,
            })}
          />
          <Timeline height={layout.timelineHeight} />
        </div>
        <ResizeHandle
          axis="x"
          title="Drag to resize the inspector · double-click to reset"
          onStart={() => beginDrag("rightWidth")}
          onEnd={endDrag}
          onReset={() => resetPanel("rightWidth")}
          // Inverted: this handle is on the inspector's LEFT edge.
          onResize={(d) => resize("rightWidth", d, {
            invert: true, containerPx: workspacePx(), otherPanelsPx: layout.leftWidth,
          })}
        />
        <InspectorPanel width={layout.rightWidth} />
        </>)}
      </div>
      {showLogs && <LogPanel onClose={() => setShowLogs(false)} />}
      {showBrowser && <ShowBrowser mode={showBrowser} onClose={() => setShowBrowser(null)} />}
      <StatusBar onToggleLogs={() => setShowLogs((v) => !v)} lastSaved={lastSaved} />
    </div>
  );
}

export default function App() {
  return (
    <WebSocketProvider>
      <StudioApp />
    </WebSocketProvider>
  );
}
