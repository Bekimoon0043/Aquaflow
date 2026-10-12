// AquaFlow Studio — LuxuryCon Professional Fixture Library
// PART 1 of 4
//
// The curated fixtures below are merged with the generated expansion library
// (AQ-S2-011) so FIXTURE_LIBRARY exposes 500+ fixtures, every one carrying both
// hydraulic (`engineering`) and electrical (`electrical`) metadata.
import EXPANDED_FIXTURES from "./fixture_library_expanded.json";

const CURATED_FIXTURES = [
  // =========================
  // NOZZLES — Vertical Jets
  // =========================
  {
    key:"nozzle_straight_dn15",
    category:"Nozzles",
    family:"Vertical Jets",
    label:"Straight Jet DN15 Ø7mm",
    color:"#00aaff",
    icon:"↑",
    engineering:{
      heightEfficiency:0.8,
      dischargeCoeff:0.93,
      kFactor:30.374,
      flowLpm:30.37,
      pressureBar:1,
      jetHeightM:8.16,
      nozzleDiaMm:7,
      sprayAngleDeg:90,
      group:"Straight Jet",
      connectionSize:"DN15",
      material:"SS304"
    }
  },
  {
    key:"nozzle_straight_dn25",
    category:"Nozzles",
    family:"Vertical Jets",
    label:"Straight Jet DN25 Ø11mm",
    color:"#00aaff",
    icon:"↑",
    engineering:{
      heightEfficiency:0.8,
      dischargeCoeff:0.93,
      kFactor:75.006,
      flowLpm:82.16,
      pressureBar:1.2,
      jetHeightM:9.79,
      nozzleDiaMm:11,
      sprayAngleDeg:90,
      group:"Straight Jet",
      connectionSize:"DN25",
      material:"SS304"
    }
  },
  {
    key:"nozzle_straight_dn40",
    category:"Nozzles",
    family:"Vertical Jets",
    label:"Straight Jet DN40 Ø17mm",
    color:"#0099ff",
    icon:"↑",
    engineering:{
      heightEfficiency:0.8,
      dischargeCoeff:0.93,
      kFactor:179.146,
      flowLpm:219.41,
      pressureBar:1.5,
      jetHeightM:12.24,
      nozzleDiaMm:17,
      sprayAngleDeg:90,
      group:"Straight Jet",
      connectionSize:"DN40",
      material:"SS304"
    }
  },
  {
    key:"nozzle_geyser",
    category:"Nozzles",
    family:"Vertical Jets",
    label:"Geyser Jet",
    color:"#00aaff",
    icon:"⬆",
    engineering:{
      heightEfficiency:0.65,
      dischargeCoeff:0.7,
      kFactor:291.612,
      flowLpm:260.83,
      pressureBar:0.8,
      jetHeightM:5.3,
      nozzleDiaMm:25,
      sprayAngleDeg:90,
      group:"Geyser",
      connectionSize:"DN40",
      material:"SS304"
    }
  },
  {
    key:"nozzle_foam_dn40",
    category:"Nozzles",
    family:"Vertical Jets",
    label:"Foam Jet DN40 Ø27mm",
    color:"#72d6ff",
    icon:"♨",
    engineering:{
      heightEfficiency:0.65,
      dischargeCoeff:0.7,
      kFactor:340.136,
      flowLpm:215.12,
      pressureBar:0.4,
      jetHeightM:2.65,
      nozzleDiaMm:27,
      sprayAngleDeg:90,
      group:"Foam Jet",
      connectionSize:"DN40",
      material:"SS304"
    }
  },
  // =========================
  // LAMINAR & JUMPING JETS
  // =========================
  {
    key:"nozzle_laminar",
    category:"Nozzles",
    family:"Laminar",
    label:"Laminar Jet",
    color:"#00ffcc",
    icon:"→",
    engineering:{
      heightEfficiency:0.85,
      dischargeCoeff:0.95,
      kFactor:91.183,
      flowLpm:49.94,
      pressureBar:0.3,
      jetHeightM:2.6,
      nozzleDiaMm:12,
      sprayAngleDeg:15,
      group:"Laminar",
      connectionSize:"DN25",
      material:"SS304"
    }
  },
  {
    key:"nozzle_laser_laminar",
    category:"Nozzles",
    family:"Laminar",
    label:"Laser Laminar",
    color:"#00ffcc",
    icon:"⇢",
    engineering:{
      heightEfficiency:0.85,
      dischargeCoeff:0.95,
      kFactor:107.013,
      flowLpm:63.31,
      pressureBar:0.35,
      jetHeightM:3.03,
      nozzleDiaMm:13,
      sprayAngleDeg:10,
      group:"Laser Laminar",
      connectionSize:"DN25",
      material:"SS304"
    }
  },
  {
    key:"nozzle_jumping_jet",
    category:"Nozzles",
    family:"Laminar",
    label:"Jumping Jet",
    color:"#00ffee",
    icon:"↷",
    engineering:{
      heightEfficiency:0.8,
      dischargeCoeff:0.95,
      kFactor:91.183,
      flowLpm:64.48,
      pressureBar:0.5,
      jetHeightM:4.08,
      nozzleDiaMm:12,
      sprayAngleDeg:12,
      group:"Jumping Jet",
      connectionSize:"DN25",
      material:"SS304"
    }
  },

  // =========================
  // FAN JETS
  // =========================
  {
    key:"nozzle_fan_small",
    category:"Nozzles",
    family:"Fan Jets",
    label:"Fan Jet Small",
    color:"#33ccff",
    icon:"◠",
    engineering:{
      heightEfficiency:0.5,
      dischargeCoeff:0.8,
      kFactor:90.116,
      flowLpm:56.99,
      pressureBar:0.4,
      jetHeightM:2.04,
      nozzleDiaMm:13,
      sprayAngleDeg:45,
      group:"Fan Jet",
      connectionSize:"DN25",
      material:"SS304"
    }
  },
  {
    key:"nozzle_fan_medium",
    category:"Nozzles",
    family:"Fan Jets",
    label:"Fan Jet Medium",
    color:"#33ccff",
    icon:"◠",
    engineering:{
      heightEfficiency:0.5,
      dischargeCoeff:0.8,
      kFactor:136.508,
      flowLpm:114.21,
      pressureBar:0.7,
      jetHeightM:3.57,
      nozzleDiaMm:16,
      sprayAngleDeg:60,
      group:"Fan Jet",
      connectionSize:"DN32",
      material:"SS304"
    }
  },
  {
    key:"nozzle_fan_large",
    category:"Nozzles",
    family:"Fan Jets",
    label:"Fan Jet Large",
    color:"#33ccff",
    icon:"◠",
    engineering:{
      heightEfficiency:0.5,
      dischargeCoeff:0.8,
      kFactor:172.767,
      flowLpm:172.77,
      pressureBar:1,
      jetHeightM:5.1,
      nozzleDiaMm:18,
      sprayAngleDeg:75,
      group:"Fan Jet",
      connectionSize:"DN40",
      material:"SS304"
    }
  },

  // =========================
  // ARCH JETS
  // =========================
  {
    key:"nozzle_arch_small",
    category:"Nozzles",
    family:"Arch Jets",
    label:"Arch Jet Small",
    color:"#55ccff",
    icon:"⌒",
    engineering:{
      heightEfficiency:0.6,
      dischargeCoeff:0.9,
      kFactor:59.989,
      flowLpm:37.94,
      pressureBar:0.4,
      jetHeightM:2.45,
      nozzleDiaMm:10,
      sprayAngleDeg:25,
      group:"Arch",
      connectionSize:"DN20",
      material:"SS304"
    }
  },
  {
    key:"nozzle_arch_medium",
    category:"Nozzles",
    family:"Arch Jets",
    label:"Arch Jet Medium",
    color:"#55ccff",
    icon:"⌒",
    engineering:{
      heightEfficiency:0.6,
      dischargeCoeff:0.9,
      kFactor:117.578,
      flowLpm:94.79,
      pressureBar:0.65,
      jetHeightM:3.98,
      nozzleDiaMm:14,
      sprayAngleDeg:30,
      group:"Arch",
      connectionSize:"DN25",
      material:"SS304"
    }
  },
  {
    key:"nozzle_arch_large",
    category:"Nozzles",
    family:"Arch Jets",
    label:"Arch Jet Large",
    color:"#55ccff",
    icon:"⌒",
    engineering:{
      heightEfficiency:0.6,
      dischargeCoeff:0.9,
      kFactor:153.571,
      flowLpm:153.57,
      pressureBar:1,
      jetHeightM:6.12,
      nozzleDiaMm:16,
      sprayAngleDeg:35,
      group:"Arch",
      connectionSize:"DN40",
      material:"SS304"
    }
  },
  // =========================
  // SPECIAL EFFECT NOZZLES
  // =========================
  {
    key:"nozzle_mist_ring",
    category:"Nozzles",
    family:"Mist Systems",
    label:"Mist Ring",
    color:"#b0ffff",
    icon:"◌",
    engineering:{
      heightBasis:"cloud",
      orificeCount:24,
      dischargeCoeff:0.7,
      kFactor:2.799,
      flowLpm:6.86,
      pressureBar:6,
      jetHeightM:0.5,
      nozzleDiaMm:0.5,
      sprayAngleDeg:360,
      group:"Mist",
      connectionSize:"DN15",
      material:"SS316"
    }
  },
  {
    key:"nozzle_fog_highpressure",
    category:"Nozzles",
    family:"Mist Systems",
    label:"High Pressure Fog",
    color:"#d8ffff",
    icon:"☁",
    engineering:{
      heightBasis:"cloud",
      orificeCount:24,
      dischargeCoeff:0.7,
      kFactor:0.252,
      flowLpm:2.11,
      pressureBar:70,
      jetHeightM:1,
      nozzleDiaMm:0.15,
      sprayAngleDeg:360,
      group:"Fog",
      connectionSize:"DN10",
      material:"SS316"
    }
  },
  {
    key:"nozzle_water_screen",
    category:"Nozzles",
    family:"Projection Systems",
    label:"Water Screen",
    color:"#88ddff",
    icon:"▤",
    engineering:{
      heightEfficiency:0.5,
      dischargeCoeff:0.8,
      kFactor:691.07,
      flowLpm:1196.97,
      pressureBar:3,
      jetHeightM:15.3,
      nozzleDiaMm:36,
      sprayAngleDeg:90,
      group:"Water Screen",
      connectionSize:"DN150",
      material:"SS304"
    }
  },
  {
    key:"nozzle_cascade_weir",
    category:"Nozzles",
    family:"Waterfall / Cascade",
    label:"Cascade Weir",
    color:"#5599ff",
    icon:"≋↓",
    engineering:{
      fallHeightM:3,
      heightBasis:"fall",
      dischargeCoeff:0.62,
      kFactor:371.93,
      flowLpm:117.61,
      pressureBar:0.1,
      jetHeightM:3,
      nozzleDiaMm:30,
      sprayAngleDeg:120,
      group:"Cascade",
      connectionSize:"DN50",
      material:"SS316"
    }
  },
  {
    key:"nozzle_cascade_curtain",
    category:"Nozzles",
    family:"Waterfall / Cascade",
    label:"Curtain Fall",
    color:"#4488ff",
    icon:"≋≋",
    engineering:{
      fallHeightM:5,
      heightBasis:"fall",
      dischargeCoeff:0.62,
      kFactor:661.209,
      flowLpm:256.09,
      pressureBar:0.15,
      jetHeightM:5,
      nozzleDiaMm:40,
      sprayAngleDeg:180,
      group:"Cascade",
      connectionSize:"DN100",
      material:"SS316"
    }
  },
  {
    key:"nozzle_volcano",
    category:"Nozzles",
    family:"Special FX",
    label:"Volcano Jet",
    color:"#ff8800",
    icon:"▲",
    engineering:{
      heightEfficiency:0.6,
      dischargeCoeff:0.7,
      kFactor:315.407,
      flowLpm:359.62,
      pressureBar:1.3,
      jetHeightM:7.95,
      nozzleDiaMm:26,
      sprayAngleDeg:90,
      group:"Volcano",
      connectionSize:"DN65",
      material:"SS304"
    }
  },

  // =========================
  // UNDERWATER LIGHTS
  // =========================
  {
    key:"light_uw_white_18w",
    category:"Lights",
    family:"Underwater Lights",
    label:"UW White 18W",
    color:"#ffffaa",
    icon:"★",
    engineering:{
      dmxChannels:1,
      colorMode:"White",
      wattage:18,
      voltage:24,
      beamAngleDeg:30,
      dmxUniverse:1,
      dmxAddress:1
    }
  },
  {
    key:"light_uw_rgb_18w",
    category:"Lights",
    family:"Underwater Lights",
    label:"UW RGB 18W",
    color:"#ffcc00",
    icon:"★",
    engineering:{
      dmxChannels:3,
      colorMode:"RGB",
      wattage:18,
      voltage:24,
      beamAngleDeg:30,
      dmxUniverse:1,
      dmxAddress:10
    }
  },
  {
    key:"light_uw_rgb_36w",
    category:"Lights",
    family:"Underwater Lights",
    label:"UW RGB 36W",
    color:"#ffcc00",
    icon:"★",
    engineering:{
      dmxChannels:3,
      colorMode:"RGB",
      wattage:36,
      voltage:24,
      beamAngleDeg:30,
      dmxUniverse:1,
      dmxAddress:20
    }
  },
  {
    key:"light_uw_rgb_54w",
    category:"Lights",
    family:"Underwater Lights",
    label:"UW RGB 54W",
    color:"#ffcc00",
    icon:"★",
    engineering:{
      dmxChannels:3,
      colorMode:"RGB",
      wattage:54,
      voltage:24,
      beamAngleDeg:15,
      dmxUniverse:1,
      dmxAddress:40
    }
  },

  // =========================
  // SPOTLIGHTS
  // =========================
  {
    key:"light_spot_50w",
    category:"Lights",
    family:"Spotlights",
    label:"Spotlight 50W",
    color:"#ffee88",
    icon:"✦",
    engineering:{
      dmxChannels:1,
      colorMode:"White",
      wattage:50,
      voltage:220,
      beamAngleDeg:10,
      dmxUniverse:2,
      dmxAddress:1
    }
  },
  {
    key:"light_spot_100w",
    category:"Lights",
    family:"Spotlights",
    label:"Spotlight 100W",
    color:"#ffee88",
    icon:"✦",
    engineering:{
      dmxChannels:1,
      colorMode:"White",
      wattage:100,
      voltage:220,
      beamAngleDeg:8,
      dmxUniverse:2,
      dmxAddress:20
    }
  },
  // =========================
  // MOVING HEADS / LASERS / EFFECTS
  // =========================
  {
    key:"light_moving_head_150w",
    category:"Lights",
    family:"Moving Heads",
    label:"Moving Head 150W",
    color:"#ff99ff",
    icon:"✺",
    engineering:{
      dmxChannels:14,
      colorMode:"RGBW",
      wattage:150,
      voltage:220,
      beamAngleDeg:12,
      dmxUniverse:2,
      dmxAddress:40
    }
  },
  {
    key:"light_moving_head_350w",
    category:"Lights",
    family:"Moving Heads",
    label:"Moving Head 350W",
    color:"#ff66ff",
    icon:"✺",
    engineering:{
      dmxChannels:16,
      colorMode:"RGBW",
      wattage:350,
      voltage:220,
      beamAngleDeg:8,
      dmxUniverse:2,
      dmxAddress:80
    }
  },
  {
    key:"laser_rgb_5w",
    category:"Laser",
    family:"Laser Effects",
    label:"RGB Laser 5W (220 V)",
    color:"#ff00ff",
    icon:"◆",
    engineering:{
      controlProtocol:"ILDA/DMX (interlocked)",
      dmxChannels:8,
      wattage:80,
      voltage:220,
      beamAngleDeg:3,
      dmxUniverse:3,
      dmxAddress:1
    }
  },
  {
    key:"laser_rgb_20w",
    category:"Laser",
    family:"Laser Effects",
    label:"RGB Laser 20W",
    color:"#ff00cc",
    icon:"◆",
    engineering:{
      controlProtocol:"ILDA/DMX (interlocked)",
      dmxChannels:8,
      wattage:300,
      voltage:220,
      beamAngleDeg:2,
      dmxUniverse:3,
      dmxAddress:30
    }
  },
  {
    key:"effect_flame_single",
    category:"Flame",
    family:"Flame Effects",
    label:"Single Flame Jet",
    color:"#ff3300",
    icon:"🔥",
    engineering:{
      wattage:80,
      voltage:220,
      gasType:"LPG",
      gasFlow:1.2,
      safetyZoneM:3,
      group:"Flame"
    }
  },
  {
    key:"effect_flame_burst",
    category:"Flame",
    family:"Flame Effects",
    label:"Flame Burst Module",
    color:"#ff2200",
    icon:"🔥",
    engineering:{
      wattage:120,
      voltage:220,
      gasType:"LPG",
      gasFlow:2.5,
      safetyZoneM:5,
      group:"Flame Burst"
    }
  },
  {
    key:"effect_air_burst",
    category:"Effects",
    family:"Air Effects",
    label:"Compressed Air Burst",
    color:"#ffaa66",
    icon:"⇪",
    engineering:{
      pressureBar:6,
      airFlowLpm:800,
      group:"Air Burst"
    }
  },
  {
    key:"effect_fog_machine",
    category:"Fog",
    family:"Fog Effects",
    label:"Fog Machine",
    color:"#ccccff",
    icon:"☁",
    engineering:{
      controlProtocol:"DMX/Relay",
      dmxChannels:2,
      wattage:1500,
      voltage:220,
      waterLpm:0.3,
      dmxUniverse:4,
      dmxAddress:1,
      group:"Fog"
    }
  }
,
  // =========================
  // PUMPS — Fountain Circulation / Jet Pumps
  // =========================
  {
    key:"pump_submersible_1_5kw",
    category:"Pumps",
    family:"Submersible Pumps",
    label:"Submersible Fountain Pump 1.5kW",
    color:"#22c55e",
    icon:"Ⓟ",
    engineering:{
      pressureBar:1.177,
      flowLpm:366.67,
      powerKw:1.5,
      voltage:220,
      phase:"1P",
      flowM3Hr:22,
      headM:12,
      connectionSize:"DN50",
      protection:"IP68",
      material:"SS304",
      controlType:"VFD/Relay",
      group:"Pump"
    },
    visual3d:{ type:"pump", scale:0.8 }
  },
  {
    key:"pump_submersible_3kw",
    category:"Pumps",
    family:"Submersible Pumps",
    label:"Submersible Fountain Pump 3kW",
    color:"#22c55e",
    icon:"Ⓟ",
    engineering:{
      pressureBar:1.765,
      flowLpm:583.33,
      powerKw:3,
      voltage:380,
      phase:"3P",
      flowM3Hr:35,
      headM:18,
      connectionSize:"DN65",
      protection:"IP68",
      material:"SS304",
      controlType:"VFD/Relay",
      group:"Pump"
    },
    visual3d:{ type:"pump", scale:1.0 }
  },
  {
    key:"pump_submersible_5_5kw",
    category:"Pumps",
    family:"Submersible Pumps",
    label:"Submersible Fountain Pump 5.5kW",
    color:"#22c55e",
    icon:"Ⓟ",
    engineering:{
      pressureBar:2.157,
      flowLpm:1000,
      powerKw:5.5,
      voltage:380,
      phase:"3P",
      flowM3Hr:60,
      headM:22,
      connectionSize:"DN80",
      protection:"IP68",
      material:"SS304",
      controlType:"VFD",
      group:"Pump"
    },
    visual3d:{ type:"pump", scale:1.2 }
  },
  {
    key:"pump_dry_centrifugal_7_5kw",
    category:"Pumps",
    family:"Dry Installed Pumps",
    label:"Dry Centrifugal Pump 7.5kW",
    color:"#16a34a",
    icon:"Ⓟ",
    engineering:{
      pressureBar:2.55,
      flowLpm:1083.33,
      powerKw:7.5,
      voltage:380,
      phase:"3P",
      flowM3Hr:65,
      headM:26,
      connectionSize:"DN100",
      installation:"Dry/Plant Room",
      material:"Cast Iron/SS Impeller",
      controlType:"VFD",
      group:"Pump"
    },
    visual3d:{ type:"pump", scale:1.4 }
  },
  {
    key:"pump_dry_centrifugal_15kw",
    category:"Pumps",
    family:"Dry Installed Pumps",
    label:"Dry Centrifugal Pump 15kW",
    color:"#16a34a",
    icon:"Ⓟ",
    engineering:{
      pressureBar:2.942,
      flowLpm:2000,
      powerKw:15,
      voltage:380,
      phase:"3P",
      flowM3Hr:120,
      headM:30,
      connectionSize:"DN150",
      installation:"Dry/Plant Room",
      material:"Cast Iron/SS Impeller",
      controlType:"VFD",
      group:"Pump"
    },
    visual3d:{ type:"pump", scale:1.7 }
  },
  {
    key:"pump_high_pressure_mist_2_2kw",
    category:"Pumps",
    family:"High Pressure Pumps",
    label:"High Pressure Mist Pump 2.2kW",
    color:"#67e8f9",
    icon:"Ⓟ",
    engineering:{
      headM:713.8,
      flowM3Hr:0.66,
      powerKw:2.2,
      voltage:220,
      phase:"1P",
      flowLpm:11,
      pressureBar:70,
      connectionSize:"DN10",
      installation:"Plant Room",
      material:"Brass/SS",
      controlType:"Relay",
      group:"Mist Pump"
    },
    visual3d:{ type:"pump", scale:0.9 }
  },

  // =========================
  // VALVES / SOLENOIDS / MANIFOLDS
  // =========================
  {
    key:"valve_solenoid_dn15_24v",
    category:"Valves",
    family:"Solenoid Valves",
    label:"Solenoid Valve DN15 24VDC",
    color:"#f97316",
    icon:"▣",
    engineering:{
      valveType:"Solenoid",
      voltage:24,
      signalType:"Digital Output",
      connectionSize:"DN15",
      pressureRatingBar:10,
      material:"Brass/SS",
      normalState:"NC",
      group:"Solenoid Valve"
    },
    visual3d:{ type:"valve", scale:0.5 }
  },
  {
    key:"valve_solenoid_dn25_24v",
    category:"Valves",
    family:"Solenoid Valves",
    label:"Solenoid Valve DN25 24VDC",
    color:"#f97316",
    icon:"▣",
    engineering:{
      valveType:"Solenoid",
      voltage:24,
      signalType:"Digital Output",
      connectionSize:"DN25",
      pressureRatingBar:10,
      material:"Brass/SS",
      normalState:"NC",
      group:"Solenoid Valve"
    },
    visual3d:{ type:"valve", scale:0.65 }
  },
  {
    key:"valve_solenoid_dn40_24v",
    category:"Valves",
    family:"Solenoid Valves",
    label:"Solenoid Valve DN40 24VDC",
    color:"#f97316",
    icon:"▣",
    engineering:{
      valveType:"Solenoid",
      voltage:24,
      signalType:"Digital Output",
      connectionSize:"DN40",
      pressureRatingBar:10,
      material:"Brass/SS",
      normalState:"NC",
      group:"Solenoid Valve"
    },
    visual3d:{ type:"valve", scale:0.85 }
  },
  {
    key:"valve_motorized_butterfly_dn100",
    category:"Valves",
    family:"Motorized Valves",
    label:"Motorized Butterfly Valve DN100",
    color:"#fb923c",
    icon:"◈",
    engineering:{
      valveType:"Motorized Butterfly",
      voltage:24,
      signalType:"0-10V / Open-Close",
      connectionSize:"DN100",
      pressureRatingBar:16,
      material:"Ductile Iron/SS Disc",
      normalState:"Last Position",
      group:"Motorized Valve"
    },
    visual3d:{ type:"valve", scale:1.2 }
  },
  {
    key:"valve_check_dn50",
    category:"Valves",
    family:"Check Valves",
    label:"Check Valve DN50 PN16",
    color:"#fb923c",
    icon:"▷",
    engineering:{
      valveType:"Check Valve",
      connectionSize:"DN50",
      pressureRatingBar:16,
      material:"SS304/Brass",
      group:"Non Return Valve"
    },
    visual3d:{ type:"valve", scale:0.7 }
  },
  {
    key:"valve_isolation_dn80",
    category:"Valves",
    family:"Isolation Valves",
    label:"Isolation Ball Valve DN80",
    color:"#fb923c",
    icon:"●",
    engineering:{
      valveType:"Ball Valve",
      connectionSize:"DN80",
      pressureRatingBar:16,
      material:"SS304",
      group:"Isolation Valve"
    },
    visual3d:{ type:"valve", scale:0.9 }
  },
  {
    key:"manifold_solenoid_8way_dn25",
    category:"Valves",
    family:"Valve Manifolds",
    label:"8-Way Solenoid Manifold DN25",
    color:"#fdba74",
    icon:"▦",
    engineering:{
      manifoldWays:8,
      inletSize:"DN80",
      outletSize:"DN25",
      voltage:24,
      totalChannels:8,
      material:"SS304",
      pressureRatingBar:10,
      group:"Valve Manifold"
    },
    visual3d:{ type:"manifold", scale:1.2 }
  },

  // =========================
  // MOVING NOZZLE MOTION SYSTEMS — 1D / 2D / 3D
  // =========================
  {
    key:"motion_nozzle_1d_tilt_motor",
    category:"Motion Systems",
    family:"1D Moving Nozzle",
    label:"1D Moving Nozzle Tilt Motor",
    color:"#a78bfa",
    icon:"↕",
    engineering:{
      motionAxis:"Tilt",
      axisCount:1,
      angleRangeDeg:120,
      speedDegSec:90,
      torqueNm:8,
      voltage:24,
      currentA:2,
      signalType:"DMX/Stepper",
      dmxChannels:2,
      group:"1D Nozzle Motion"
    },
    visual3d:{ type:"motion_nozzle", axisCount:1 }
  },
  {
    key:"motion_nozzle_2d_pan_tilt_motor",
    category:"Motion Systems",
    family:"2D Moving Nozzle",
    label:"2D Moving Nozzle Pan/Tilt Motor",
    color:"#8b5cf6",
    icon:"↔",
    engineering:{
      motionAxis:"Pan/Tilt",
      axisCount:2,
      panRangeDeg:360,
      tiltRangeDeg:120,
      speedDegSec:120,
      torqueNm:12,
      voltage:24,
      currentA:4,
      signalType:"DMX/Stepper",
      dmxChannels:4,
      group:"2D Nozzle Motion"
    },
    visual3d:{ type:"motion_nozzle", axisCount:2 }
  },
  {
    key:"motion_nozzle_3d_robotic_module",
    category:"Motion Systems",
    family:"3D Robotic Nozzle",
    label:"3D Robotic Nozzle Module",
    color:"#7c3aed",
    icon:"✣",
    engineering:{
      motionAxis:"Pan/Tilt/Lift",
      axisCount:3,
      panRangeDeg:360,
      tiltRangeDeg:135,
      liftStrokeMm:300,
      speedDegSec:150,
      voltage:24,
      currentA:6,
      signalType:"DMX/Servo",
      dmxChannels:6,
      group:"3D Robotic Nozzle"
    },
    visual3d:{ type:"motion_nozzle", axisCount:3 }
  },

  // =========================
  // RGB / DMX LIGHTING — MORE SPECIFIC TYPES
  // =========================
  {
    key:"light_uw_rgbw_72w",
    category:"Lights",
    family:"Underwater RGBW Lights",
    label:"UW RGBW 72W",
    color:"#ffdd55",
    icon:"✹",
    engineering:{
      wattage:72,
      voltage:24,
      beamAngleDeg:25,
      colorMode:"RGBW",
      dmxChannels:4,
      dmxUniverse:1,
      dmxAddress:60,
      ipRating:"IP68",
      material:"SS316",
      group:"RGBW Underwater Light"
    },
    visual3d:{ type:"underwater_light", lightColor:"#ffffff", rgb:true, intensity:1.4 }
  },
  {
    key:"light_ring_rgb_24w",
    category:"Lights",
    family:"Ring Lights",
    label:"RGB Ring Light 24W",
    color:"#ffcc00",
    icon:"◎",
    engineering:{
      wattage:24,
      voltage:24,
      colorMode:"RGB",
      dmxChannels:3,
      dmxUniverse:1,
      dmxAddress:80,
      ipRating:"IP68",
      group:"RGB Ring Light"
    },
    visual3d:{ type:"ring_light", rgb:true, intensity:0.9 }
  },
  {
    key:"light_linear_rgbw_1m",
    category:"Lights",
    family:"Linear Lights",
    label:"Linear RGBW Light 1m",
    color:"#ffd166",
    icon:"━",
    engineering:{
      wattage:36,
      voltage:24,
      lengthM:1,
      colorMode:"RGBW",
      dmxChannels:4,
      dmxUniverse:1,
      dmxAddress:100,
      ipRating:"IP67",
      group:"Linear RGBW Light"
    },
    visual3d:{ type:"linear_light", rgb:true, lengthM:1 }
  },

  // =========================
  // AIR / PNEUMATIC SYSTEMS
  // =========================
  {
    key:"air_compressor_2_2kw",
    category:"Air Systems",
    family:"Compressors",
    label:"Air Compressor 2.2kW (1-phase)",
    color:"#94a3b8",
    icon:"◎",
    engineering:{
      phase:"1P",
      powerKw:2.2,
      voltage:220,
      pressureBar:8,
      airFlowLpm:300,
      tankVolumeL:100,
      noiseDb:75,
      group:"Air Compressor"
    },
    visual3d:{ type:"compressor", scale:1.0 }
  },
  {
    key:"air_compressor_7_5kw",
    category:"Air Systems",
    family:"Compressors",
    label:"Air Compressor 7.5kW",
    color:"#94a3b8",
    icon:"◎",
    engineering:{
      phase:"3P",
      powerKw:7.5,
      voltage:380,
      pressureBar:10,
      airFlowLpm:900,
      tankVolumeL:300,
      noiseDb:82,
      group:"Air Compressor"
    },
    visual3d:{ type:"compressor", scale:1.5 }
  },
  {
    key:"air_tank_300l",
    category:"Air Systems",
    family:"Air Receivers",
    label:"Air Receiver Tank 300L",
    color:"#cbd5e1",
    icon:"◖",
    engineering:{
      tankVolumeL:300,
      pressureBar:10,
      material:"Carbon Steel",
      safetyValve:true,
      drainValve:true,
      group:"Air Tank"
    },
    visual3d:{ type:"tank", scale:1.1 }
  },

  // =========================
  // FLAME / FUEL / SAFETY SYSTEMS
  // =========================
  {
    key:"fuel_lpg_tank_100kg",
    category:"Flame",
    family:"Fuel Supply",
    label:"LPG Fuel Tank 100kg",
    color:"#ef4444",
    icon:"⛽",
    engineering:{
      fuelType:"LPG",
      capacityKg:100,
      pressureRegulator:true,
      safetyValve:true,
      gasDetectorRequired:true,
      safetyZoneM:5,
      group:"Fuel Tank"
    },
    visual3d:{ type:"fuel_tank", scale:1.0 }
  },
  {
    key:"fuel_lpg_manifold_4way",
    category:"Flame",
    family:"Fuel Manifold",
    label:"LPG 4-Way Flame Manifold",
    color:"#f97316",
    icon:"♨",
    engineering:{
      fuelType:"LPG",
      manifoldWays:4,
      inletSize:"1 inch",
      outletSize:"1/2 inch",
      solenoidVoltage:24,
      flameArrestor:true,
      group:"Flame Fuel Manifold"
    },
    visual3d:{ type:"fuel_manifold", scale:0.9 }
  },
  {
    key:"safety_gas_detector",
    category:"Safety",
    family:"Gas Safety",
    label:"Gas Leak Detector",
    color:"#ef4444",
    icon:"⚠",
    engineering:{
      sensorType:"LPG Gas Detector",
      voltage:24,
      signalType:"Digital Input/Alarm",
      alarmOutput:true,
      group:"Safety Sensor"
    },
    visual3d:{ type:"sensor", scale:0.4 }
  },
  {
    key:"safety_emergency_stop",
    category:"Safety",
    family:"Emergency Control",
    label:"Emergency Stop Button",
    color:"#dc2626",
    icon:"■",
    engineering:{
      voltage:24,
      signalType:"Safety Input",
      resetType:"Manual",
      group:"Emergency Stop"
    },
    visual3d:{ type:"button", scale:0.3 }
  },

  // =========================
  // CONTROL / DMX / PLC / POWER
  // =========================
  {
    key:"control_plc_main_32io",
    category:"Controls",
    family:"PLC Panels",
    label:"Main PLC Controller 32 I/O",
    color:"#38bdf8",
    icon:"▣",
    engineering:{
      digitalInputs:16,
      digitalOutputs:16,
      analogInputs:4,
      analogOutputs:4,
      communication:"Ethernet/Modbus",
      voltage:24,
      panelMount:true,
      group:"PLC"
    },
    visual3d:{ type:"control_panel", scale:1.0 }
  },
  {
    key:"control_dmx_decoder_24ch",
    category:"Controls",
    family:"DMX Decoders",
    label:"DMX Decoder 24 Channel",
    color:"#38bdf8",
    icon:"DMX",
    engineering:{
      dmxChannels:24,
      voltage:24,
      maxCurrentA:24,
      outputType:"PWM Constant Voltage",
      dmxUniverse:1,
      group:"DMX Decoder"
    },
    visual3d:{ type:"dmx_decoder", scale:0.5 }
  },
  {
    key:"control_vfd_7_5kw",
    category:"Controls",
    family:"VFD Drives",
    label:"VFD Drive 7.5kW",
    color:"#0ea5e9",
    icon:"VFD",
    engineering:{
      powerKw:7.5,
      inputVoltage:380,
      outputVoltage:380,
      controlSignal:"0-10V/Modbus",
      protection:"IP20 Panel Mount",
      group:"VFD"
    },
    visual3d:{ type:"vfd", scale:0.7 }
  },
  {
    key:"power_supply_24v_20a",
    category:"Power",
    family:"DC Power Supplies",
    label:"24V DC Power Supply 20A",
    color:"#facc15",
    icon:"▰",
    engineering:{
      outputVoltage:24,
      outputCurrentA:20,
      outputPowerW:480,
      inputVoltage:220,
      protection:"Short Circuit/Overload",
      group:"Power Supply"
    },
    visual3d:{ type:"power_supply", scale:0.5 }
  },
  {
    key:"junction_box_ip68",
    category:"Electrical",
    family:"Junction Boxes",
    label:"IP68 Junction Box",
    color:"#facc15",
    icon:"□",
    engineering:{
      ipRating:"IP68",
      terminals:8,
      material:"Polycarbonate/SS",
      cableGlands:4,
      group:"Junction Box"
    },
    visual3d:{ type:"junction_box", scale:0.35 }
  },
  {
    key:"sensor_water_level",
    category:"Sensors",
    family:"Water Sensors",
    label:"Water Level Sensor",
    color:"#06b6d4",
    icon:"▾",
    engineering:{
      sensorType:"Level Sensor",
      signalType:"Digital/Analog Input",
      voltage:24,
      group:"Water Level Sensor"
    },
    visual3d:{ type:"sensor", scale:0.35 }
  },
  {
    key:"sensor_pressure_0_10bar",
    category:"Sensors",
    family:"Hydraulic Sensors",
    label:"Pressure Sensor 0-10 bar",
    color:"#06b6d4",
    icon:"◉",
    engineering:{
      sensorType:"Pressure Transmitter",
      rangeBar:"0-10",
      signalType:"4-20mA",
      voltage:24,
      group:"Pressure Sensor"
    },
    visual3d:{ type:"sensor", scale:0.35 }
  },
  {
    key:"sensor_flow_dn50",
    category:"Sensors",
    family:"Hydraulic Sensors",
    label:"Flow Meter DN50",
    color:"#06b6d4",
    icon:"↝",
    engineering:{
      sensorType:"Flow Meter",
      connectionSize:"DN50",
      signalType:"Pulse/4-20mA",
      flowRangeM3Hr:"5-60",
      voltage:24,
      group:"Flow Meter"
    },
    visual3d:{ type:"sensor", scale:0.5 }
  },

  // =========================
  // FILTRATION / WATER TREATMENT
  // =========================
  {
    key:"filter_sand_dn650",
    category:"Filtration",
    family:"Sand Filters",
    label:"Sand Filter Ø650",
    color:"#a3e635",
    icon:"◍",
    engineering:{
      filterDiameterMm:650,
      flowM3Hr:15,
      connectionSize:"DN50",
      media:"Silica Sand",
      maxPressureBar:2.5,
      group:"Sand Filter"
    },
    visual3d:{ type:"filter", scale:0.8 }
  },
  {
    key:"filter_sand_dn900",
    category:"Filtration",
    family:"Sand Filters",
    label:"Sand Filter Ø900",
    color:"#a3e635",
    icon:"◍",
    engineering:{
      filterDiameterMm:900,
      flowM3Hr:30,
      connectionSize:"DN80",
      media:"Silica Sand",
      maxPressureBar:2.5,
      group:"Sand Filter"
    },
    visual3d:{ type:"filter", scale:1.1 }
  },
  {
    key:"dosing_chlorine_pump",
    category:"Water Treatment",
    family:"Dosing Systems",
    label:"Chemical Dosing Pump",
    color:"#10b981",
    icon:"+",
    engineering:{
      dosingChemical:"Chlorine/Acid",
      flowLph:5,
      pressureBar:5,
      voltage:220,
      currentA:0.3,
      group:"Chemical Dosing"
    },
    visual3d:{ type:"dosing_pump", scale:0.45 }
  },
  {
    key:"uv_sterilizer_80w",
    category:"Water Treatment",
    family:"UV Systems",
    label:"UV Sterilizer 80W",
    color:"#a855f7",
    icon:"UV",
    engineering:{
      wattage:80,
      voltage:220,
      flowM3Hr:20,
      connectionSize:"DN50",
      lampLifeHours:9000,
      group:"UV Sterilizer"
    },
    visual3d:{ type:"uv", scale:0.6 }
  }

];

// ── Merge curated + generated fixtures, guaranteeing every entry carries both a
// hydraulic and an electrical metadata block (AQ-S2-011) ──────────────────────
// Induction motors (pumps, compressors, blowers, VFD-driven loads) run at a
// lower power factor and draw their rated SHAFT power at <100 % efficiency;
// lights and electronics keep pf 0.9 / eff 1.0.
const MOTOR_PF = 0.85;
const MOTOR_EFF = 0.88;
const DEFAULT_PF = 0.9;

// Every library item is a generic template until a real manufacturer/model is
// attached — none are yet, so all of them are flagged.
export const GENERIC_DATA_SOURCE = "AquaFlow generic template — verify with the supplier datasheet";

function computeAmps(powerW, voltageV, phase, pf = DEFAULT_PF, eff = 1) {
  if (powerW <= 0 || voltageV <= 0) return 0;
  if (phase === 3) return Math.round((powerW / (Math.sqrt(3) * voltageV * pf * eff)) * 1000) / 1000;
  if (phase === 1) return Math.round((powerW / (voltageV * pf * eff)) * 1000) / 1000;
  return Math.round((powerW / voltageV) * 1000) / 1000; // DC
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "3P" / "3-phase" / "three phase" / 3 → 3; "1P" / "1-phase" / "single" / 1 → 1; else null. */
export function parsePhase(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value === 3 ? 3 : value === 1 ? 1 : value === 0 ? 0 : null;
  const s = String(value).trim().toLowerCase();
  if (/^(3|3p|3ph|3~)$|^3[\s-]*phase|three/.test(s)) return 3;
  if (/^(1|1p|1ph|1~)$|^1[\s-]*phase|single/.test(s)) return 1;
  if (/^(0|dc)$/.test(s)) return 0;
  return null;
}

function isMotorLoad(f) {
  if (f.category === "Pumps") return true;
  return /compressor|blower|vfd|\bpump\b|_pump|pump_/i.test(`${f.key || ""} ${f.label || ""}`)
    && !/dosing|motion_nozzle/i.test(f.key || "");
}

function deriveElectrical(f) {
  // Curated fixtures store electrical fields inside `engineering`; surface them
  // into a normalized `electrical` block so every fixture is consistent.
  const e = f.engineering || {};
  const isLight = f.category === "Lights";
  const isPassiveWater = ["Nozzles"].includes(f.category);
  const voltageV = num(e.voltage ?? e.voltageV ?? e.inputVoltage ?? e.solenoidVoltage)
    || (isLight || isPassiveWater ? 24 : 0);
  const powerKw = num(e.powerKw);
  const powerW = num(e.wattage) ?? num(e.powerW) ?? (powerKw !== null ? powerKw * 1000 : null)
    ?? num(e.outputPowerW)
    // A nozzle's electrical interface is its 24 V solenoid coil (matches the generated nozzles).
    ?? (isPassiveWater ? 12 : 0);
  let phase = parsePhase(e.phase);
  if (phase === null) phase = voltageV >= 380 ? 3 : voltageV >= 100 ? 1 : 0;
  if (voltageV >= 380 && phase === 1) phase = 3; // never a 400 V single-phase load
  if (voltageV > 0 && voltageV < 100) phase = 0; // 12/24/48 V supplies are DC
  const motor = isMotorLoad(f);
  const pf = motor ? MOTOR_PF : DEFAULT_PF;
  const eff = motor ? MOTOR_EFF : 1;
  const electrical = {
    voltageV,
    powerW,
    currentA: num(e.currentA) ?? computeAmps(powerW, voltageV, phase, pf, eff),
    phase,
    controlProtocol: e.controlProtocol
      || (isLight ? "DMX/Art-Net" : isPassiveWater ? "Modbus/Relay (solenoid valve)" : "Modbus"),
    dmxChannels: num(e.dmxChannels) ?? (isLight ? (/rgbw/i.test(f.key) ? 4 : /rgb/i.test(f.key) ? 3 : 1) : 0),
    ipRating: e.ipRating || "IP68",
  };
  if (motor) {
    electrical.powerFactor = pf;
    electrical.efficiency = eff;
  }
  return electrical;
}

function normalizeFixture(f) {
  const engineering = { ...(f.engineering || {}) };
  if (!engineering.dataSource) engineering.dataSource = GENERIC_DATA_SOURCE;
  return {
    ...f,
    // No library entry carries a real manufacturer/model yet → all are generic.
    source: f.source || (f.manufacturer && f.model ? "datasheet" : "generic"),
    generic: f.generic ?? !(f.manufacturer && f.model),
    engineering,
    electrical: f.electrical || deriveElectrical(f),
  };
}

export const FIXTURE_LIBRARY = [
  ...CURATED_FIXTURES.map(normalizeFixture),
  ...EXPANDED_FIXTURES.map(normalizeFixture),
];

const FIXTURE_BY_KEY = new Map(FIXTURE_LIBRARY.map(f => [f.key, f]));

export const FIXTURE_CATEGORIES =
  [...new Set(FIXTURE_LIBRARY.map(f => f.category))];

export const FIXTURE_FAMILIES =
  [...new Set(FIXTURE_LIBRARY.map(f => f.family))];

/**
 * Neutral stand-in for a type key the library does not know. It deliberately
 * carries NO engineering defaults, NO electrical load and NO plcChannel, so an
 * unknown fixture can never silently inherit another product's data (it used to
 * fall back to FIXTURE_LIBRARY[0] — Straight Jet DN15 on Q0.1).
 */
export const UNKNOWN_FIXTURE_KEY = "unknown";
function unknownFixtureType(requestedKey) {
  return {
    key: UNKNOWN_FIXTURE_KEY,
    requestedKey: requestedKey ?? null,
    category: "Unknown",
    family: "Unknown",
    label: "Unknown / generic equipment",
    color: "#94a3b8",
    icon: "?",
    source: "generic",
    generic: true,
    unknown: true,
    engineering: {},
    electrical: {
      voltageV: 0, powerW: 0, currentA: 0, phase: 0,
      controlProtocol: "", dmxChannels: 0, ipRating: "",
    },
  };
}

/** The library entry for `key`, or null when the key is not in the library. */
export const getFixtureLibraryEntry = (key) => FIXTURE_BY_KEY.get(key) || null;

/** The library entry for `key`, or a neutral "Unknown" entry (never another product). */
export const getFixtureType = (key) =>
  FIXTURE_BY_KEY.get(key) || unknownFixtureType(key);

export const getDefaultEngineering = (key) =>
  ({ ...(getFixtureType(key).engineering || {}) });

function firstNumber(...values) {
  for (const v of values) {
    if (v === undefined || v === null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Nameplate ratings of a placed fixture, for totals / BOM / DMX footprint.
 *
 * Placed instances only carry a copy of `engineering`, and generated library
 * items keep their power and DMX footprint in the normalized `electrical` block,
 * so reading `engineering.wattage` / `powerKw` / `dmxChannels` alone counted
 * them as 0 W / 0 DMX. Values the instance's own `engineering` sets always win
 * (they may have been edited); otherwise fall back to the instance's
 * `electrical` block, then the library entry's.
 *
 * @returns {{ flowLpm:number, flowM3Hr:number, powerW:number, powerKw:number, dmxChannels:number }}
 */
export function getFixtureRatings(fixture = {}) {
  const eng = fixture?.engineering || {};
  const lib = getFixtureLibraryEntry(fixture?.type ?? fixture?.key);
  const elec = fixture?.electrical || lib?.electrical || {};

  let flowLpm = firstNumber(eng.flowLpm);
  const flowM3HrOwn = firstNumber(eng.flowM3Hr);
  if (flowLpm === null && flowM3HrOwn !== null) flowLpm = flowM3HrOwn / 0.06;
  if (flowLpm === null) {
    const lph = firstNumber(eng.flowLph);
    flowLpm = lph !== null ? lph / 60 : 0;
  }
  const flowM3Hr = flowM3HrOwn ?? flowLpm * 0.06;

  const kw = firstNumber(eng.powerKw);
  const powerW = firstNumber(eng.wattage, eng.powerW)
    ?? (kw !== null ? kw * 1000 : null)
    ?? firstNumber(eng.outputPowerW, elec.powerW)
    ?? 0;

  const dmxChannels = firstNumber(eng.dmxChannels, elec.dmxChannels) ?? 0;

  return { flowLpm, flowM3Hr, powerW, powerKw: powerW / 1000, dmxChannels };
}

export const fixtureLibraryStats = {
  total: FIXTURE_LIBRARY.length,
  categories: FIXTURE_CATEGORIES.length,
  families: FIXTURE_FAMILIES.length
};