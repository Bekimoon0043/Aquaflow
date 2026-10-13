/**
 * useEngineeringPublisher.js
 *
 * Drop-in hook for PoolGeometryDesigner (or any Engineering Design panel).
 * Call this hook inside the component and pass it the current state.
 * It will publish to the engineering store on every change.
 *
 * Usage inside PoolGeometryDesigner:
 *
 *   import { useEngineeringPublisher } from "../../hooks/engineeringPublisher";
 *
 *   // inside component, after all state declarations:
 *   useEngineeringPublisher({
 *     projectName, geometry, poolType, params,
 *     fixtures, layers, measurements,
 *     hydraulicSummary, bomItems,
 *   });
 */

import { useEffect, useRef } from "react";
import useEngineeringStore from "../store/engineeringStore";

export function useEngineeringPublisher(data) {
  const updateEngineering = useEngineeringStore(s => s.updateEngineering);
  const debounceRef = useRef(null);

  useEffect(() => {
    // Debounce 80ms — avoid flooding during drag operations
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      updateEngineering({
        projectName:      data.projectName,
        geometry:         data.geometry,
        poolType:         data.poolType,
        params:           data.params,
        // AF-NEXT-010: all basins (basins[0] === geometry). Omitted by legacy callers.
        ...(Array.isArray(data.basins) ? { basins: data.basins } : {}),
        // AF-CAD-034: groups as ID lists. Omitted by callers that do not manage groups.
        ...(Array.isArray(data.groups) ? { groups: data.groups } : {}),
        fixtures:         data.fixtures         || [],
        siteSurfaces:     data.siteSurfaces      || [],
        manualPipes:      data.manualPipes      || [],
        pipes:            data.manualPipes      || [],
        layers:           data.layers           || [],
        measurements:     data.measurements     || [],
        depthZones:       data.depthZones       || [],
        hydraulicSummary: data.hydraulicSummary || {},
        solvedHydraulics:  data.solvedHydraulics || null,
        bomItems:         data.bomItems         || [],
     });
    }, 80);
    return () => clearTimeout(debounceRef.current);
  }, [
    data.projectName,
    data.geometry,
    data.poolType,
    data.params,
    data.basins,
    data.groups,
    data.fixtures,
    data.siteSurfaces,
    data.manualPipes,
    data.layers,
    data.measurements,
    data.depthZones,
    data.hydraulicSummary,
    data.solvedHydraulics,
    data.bomItems,
  ]);
}
