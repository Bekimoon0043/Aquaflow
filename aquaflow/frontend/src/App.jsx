import { useState } from "react";
import { Component } from "react";
import { WebSocketProvider } from "./hooks/WebSocketContext";
import { useAutoSave } from "./hooks/useAutoSave";
import { useServerShowSync } from "./hooks/useServerShowSync";
import TopBar from "./components/TopBar";
import NodeEditor from "./components/nodes/NodeEditor";
import Timeline from "./components/timeline/Timeline";
import DevicePanel from "./components/panels/DevicePanel";
import InspectorPanel from "./components/panels/InspectorPanel";
import PreviewPanel from "./components/preview/PreviewPanel_v5";
import AIPanel from "./components/panels/AIPanel";
import DeviceDiscoveryPanel from "./components/panels/DeviceDiscoveryPanel";
import AudioPanel from "./components/panels/AudioPanel";
import PLCPanel from "./components/panels/PLCPanel";
import SchedulerPanel from "./components/panels/SchedulerPanel";
import SafetyMonitorPanel from "./components/panels/SafetyMonitorPanel";
import OperatorPanel from "./components/panels/OperatorPanel";
import DiagnosticsPanel from "./components/panels/DiagnosticsPanel";
import DependencyGraphPanel from "./components/panels/DependencyGraphPanel";
import RealtimeValidationPanel from "./components/panels/RealtimeValidationPanel";
import WindDriftPanel from "./components/panels/WindDriftPanel";
import EngineeringToolsPanel from "./components/panels/EngineeringToolsPanel";
import MobileMonitorPanel from "./components/panels/MobileMonitorPanel";
import CollaborationPanel from "./components/panels/CollaborationPanel";
import EnvironmentMaterialPanel from "./components/panels/EnvironmentMaterialPanel";
import TrainingAcademyPanel from "./components/panels/TrainingAcademyPanel";
import DocumentationPanel from "./components/panels/DocumentationPanel";
import DigitalTwinPanel from "./components/panels/DigitalTwinPanel";
import OptimizationPanel from "./components/panels/OptimizationPanel";
import AdaptationPanel from "./components/panels/AdaptationPanel";
import FleetPanel from "./components/panels/FleetPanel";
import CloudPanel from "./components/panels/CloudPanel";
import CompilePanel from "./components/panels/CompilePanel";
import PresetBrowser from "./components/panels/PresetBrowser";
import CalibrationPanel from "./components/panels/CalibrationPanel";
import KeyframeEditor from "./components/timeline/KeyframeEditor";
import PoolGeometryDesigner from "./components/panels/PoolGeometryDesigner";
import PatternDesignerPanel from "./components/panels/PatternDesignerPanel";
import ShowProgrammerPanel from "./components/programmer/ShowProgrammerPanel";
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
            {activePanel === "compile"      && <CompilePanel />}
            {activePanel === "presets"      && <PresetBrowser />}
            {activePanel === "calibration"  && <CalibrationPanel />}
            {activePanel === "keyframes"    && <KeyframeEditor durationMs={8000} />}
            {activePanel === "geometry"     && <PoolGeometryDesigner />}
            {activePanel === "patterns" && <PatternDesignerPanel />}
            {activePanel === "show_programmer" && <ShowProgrammerPanel />}
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
