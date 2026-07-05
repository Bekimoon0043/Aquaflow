import { useState, lazy, Suspense } from "react";
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
const ShowProgrammerPanel = lazy(() => import("./components/programmer/ShowProgrammerPanel"));
import StatusBar from "./components/StatusBar";
import ConnectionBanner from "./components/ConnectionBanner";
import LogPanel from "./components/LogPanel";
import ShowBrowser from "./components/ShowBrowser";
import { useShowStore } from "./store/showStore";
import "./styles/globals.css";



function StudioApp() {
  const [layout] = useState({ leftWidth: 260, rightWidth: 300, timelineHeight: 280 });
  const [activePanel, setActivePanel] = useState("nodes");
  const [showLogs, setShowLogs] = useState(false);
  const [showBrowser, setShowBrowser] = useState(null);
  const { isDirty } = useShowStore();
  const { lastSaved } = useAutoSave();
  useServerShowSync();

  return (
    <div className="app-shell">
      <ConnectionBanner />
      <TopBar
        activePanel={activePanel}
        setActivePanel={setActivePanel}
        onToggleLogs={() => setShowLogs((v) => !v)}
        onOpenBrowser={(mode) => setShowBrowser(mode)}
        isDirty={isDirty}
        lastSaved={lastSaved}
      />
      <div className="workspace">
        <DevicePanel width={layout.leftWidth} />
        <div className="center-stack">
          <div className="editor-area">
           <Suspense fallback={<div style={{ padding: 24, color: "var(--text-muted)", fontSize: 12 }}>Loading…</div>}>
            {activePanel === "nodes"        && <NodeEditor />}
            {activePanel === "preview"      && <PreviewPanel />}
            {activePanel === "ai"           && <AIPanel />}
            {activePanel === "devices"      && <DeviceDiscoveryPanel />}
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
            {activePanel === "geometry"     && <PoolGeometryDesigner />}
            {activePanel === "patterns" && <PatternDesignerPanel />}
            {activePanel === "show_programmer" && <ShowProgrammerPanel />}
           </Suspense>
          </div>
          <Timeline height={layout.timelineHeight} />
        </div>
        <InspectorPanel width={layout.rightWidth} />
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
