/**
 * frontend/src/components/LicenseGate.jsx
 * Wraps any panel that requires a specific license feature.
 * Shows a lock screen if the current license does not include the feature.
 *
 * Usage:
 *   <LicenseGate feature="engineering_designer">
 *     <PoolGeometryDesigner />
 *   </LicenseGate>
 */

import React from "react";
import { useLicense } from "../hooks/useLicense";

const FEATURE_LABELS = {
  engineering_designer: "Engineering Designer",
  "3d_preview":         "3D Preview",
  show_programmer:      "Show Programmer",
  ai_choreography:      "AI Choreography",
  pattern_designer:     "Pattern Designer",
  save:                 "Save",
  export:               "Export",
};

export default function LicenseGate({ feature, children, silent = false, fallback = null }) {
  const { loading, hasFeature, edition, company_name } = useLicense();

  if (loading) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                    height:"100%", gap:8 }}>
        <span style={{ fontSize:8, color:"var(--accent)" }}>●</span>
        <span style={{ fontSize:11, color:"var(--text-muted)", fontFamily:"var(--font-mono)" }}>
          Verifying license…
        </span>
      </div>
    );
  }

  if (!feature || hasFeature(feature)) {
    return children;
  }

  if (silent) return fallback || null;

  const featureLabel = FEATURE_LABELS[feature] || feature;

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                  height:"100%", width:"100%", background:"var(--bg-panel)" }}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                    padding:"28px 32px", background:"var(--bg-surface)",
                    border:"1px solid var(--border)", borderRadius:10,
                    maxWidth:300, textAlign:"center", gap:10 }}>
        <div style={{ fontSize:28 }}>🔒</div>
        <div style={{ fontSize:14, fontWeight:600, color:"var(--text-primary)" }}>
          {featureLabel}
        </div>
        <div style={{ fontSize:11, color:"var(--text-muted)" }}>
          Not included in your beta license
        </div>
        <div style={{ width:"100%", height:1, background:"var(--border)" }} />
        <div style={{ fontSize:10, color:"var(--text-muted)", lineHeight:1.6 }}>
          Contact LuxuryCon Fountain Systems to upgrade.
        </div>
        <div style={{ fontSize:11, color:"var(--accent)", fontFamily:"var(--font-mono)",
                      padding:"4px 12px", background:"rgba(0,212,255,0.06)",
                      border:"1px solid rgba(0,212,255,0.2)", borderRadius:4 }}>
          support@luxurycon.com
        </div>
      </div>
    </div>
  );
}
