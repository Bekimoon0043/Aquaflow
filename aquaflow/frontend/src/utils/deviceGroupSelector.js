// src/utils/deviceGroupSelector.js
// Creates professional fountain device groups from nozzle/device data.

export const DEFAULT_DEVICE_GROUPS = [
  {
    id: "center_jets",
    name: "Center Jets",
    type: "water",
    matchNozzleTypes: ["jet_1d", "jet_2d", "jet_3d", "geyser", "laminar", "pirouette"],
  },
{
    id: "motion_1d_jets",
    name: "1D Motion Jets",
    type: "water",
    matchNozzleTypes: ["motion_1d"],
  },
  {
    id: "motion_2d_jets",
    name: "2D Motion Jets",
    type: "water",
    matchNozzleTypes: ["motion_2d"],
  },
  {
    id: "motion_3d_jets",
    name: "3D Motion Jets",
    type: "water",
    matchNozzleTypes: ["motion_3d"],
  },
  {
    id: "outer_ring_jets",
    name: "Outer Ring Jets",
    type: "water",
    matchNozzleTypes: ["ring"],
  },
  {
    id: "arch_jets",
    name: "Arch Jets",
    type: "water",
    matchNozzleTypes: ["arch"],
  },
  {
    id: "cascade_jets",
    name: "Cascade Jets",
    type: "water",
    matchNozzleTypes: ["cascade"],
  },
  {
    id: "screen_jets",
    name: "Water Screen",
    type: "water",
    matchNozzleTypes: ["screen"],
  },
  {
    id: "mist_jets",
    name: "Mist Jets",
    type: "fog",
    matchNozzleTypes: ["mist"],
  },
  {
    id: "rgb_lights",
    name: "RGB Lights",
    type: "lighting",
    matchDeviceTypes: ["light", "lighting", "led", "rgb", "dmx"],
  },
  {
    id: "fog_machines",
    name: "Fog Machines",
    type: "fog",
    matchDeviceTypes: ["fog", "mist", "smoke"],
  },
  {
    id: "flame_units",
    name: "Flame Units",
    type: "flame",
    matchDeviceTypes: ["flame", "fire"],
  },
  {
    id: "laser_units",
    name: "Laser Units",
    type: "laser",
    matchDeviceTypes: ["laser"],
  },
];

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

export function buildDeviceGroups({ nozzles = [], devices = [], groups = DEFAULT_DEVICE_GROUPS } = {}) {
  return groups.map(group => {
    const nozzleMembers = nozzles
      .map((nozzle, index) => ({
        ...nozzle,
        index,
        memberType: "nozzle",
      }))
      .filter(nozzle => {
        const nozzleType = normalize(nozzle.type || nozzle.nozzleType || nozzle.kind);
        return group.matchNozzleTypes?.includes(nozzleType);
      });

    const deviceMembers = devices
      .map((device, index) => ({
        ...device,
        index,
        memberType: "device",
      }))
      .filter(device => {
        const deviceType = normalize(device.type || device.deviceType || device.kind || device.category);
        return group.matchDeviceTypes?.includes(deviceType);
      });

    return {
      ...group,
      members: [...nozzleMembers, ...deviceMembers],
      memberCount: nozzleMembers.length + deviceMembers.length,
    };
  });
}

export function createEmptyGroupSignals(groups = DEFAULT_DEVICE_GROUPS) {
  return Object.fromEntries(groups.map(group => [group.id, 0]));
}