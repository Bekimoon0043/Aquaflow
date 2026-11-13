export class PhotometricParseError extends Error {
  constructor(format, message, line = null) {
    super(`Invalid ${format}: ${message}${line == null ? "" : ` at line ${line}`}`);
    this.name = "PhotometricParseError";
    this.format = format;
    this.line = line;
  }
}

const IES_FORMAT = "IES LM-63";
const LDT_FORMAT = "EULUMDAT LDT";

function textLines(text, format) {
  if (typeof text !== "string") throw new TypeError(`${format} input must be a string`);
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
}

function fail(format, message, line = null) {
  throw new PhotometricParseError(format, message, line);
}

function toNumber(token, format, label, line) {
  const normalised = String(token).trim();
  const value = Number(normalised.includes(",") && !normalised.includes(".") ? normalised.replace(",", ".") : normalised);
  if (!normalised || !Number.isFinite(value)) fail(format, `${label} must be a finite number`, line);
  return value;
}

function requireInteger(value, format, label, line, minimum = null) {
  if (!Number.isInteger(value)) fail(format, `${label} must be an integer`, line);
  if (minimum != null && value < minimum) fail(format, `${label} must be >= ${minimum}`, line);
  return value;
}

function increasing(values, format, label, line = null) {
  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index] > values[index - 1])) fail(format, `${label} must be strictly increasing`, line);
  }
  return values;
}

class NumericCursor {
  constructor(lines, start, format) {
    this.format = format;
    this.tokens = [];
    for (let index = start; index < lines.length; index += 1) {
      const parts = lines[index].trim().split(/\s+/).filter(Boolean);
      for (const token of parts) this.tokens.push({ token, line: index + 1 });
    }
    this.index = 0;
  }

  read(label) {
    if (this.index >= this.tokens.length) fail(this.format, `missing ${label}`);
    const item = this.tokens[this.index++];
    return { value: toNumber(item.token, this.format, label, item.line), line: item.line };
  }

  integer(label, minimum = null) {
    const item = this.read(label);
    return requireInteger(item.value, this.format, label, item.line, minimum);
  }

  values(count, label) {
    return Array.from({ length: count }, () => this.read(label).value);
  }

  ensureEnd() {
    if (this.index < this.tokens.length) {
      fail(this.format, "unexpected data after the candela table", this.tokens[this.index].line);
    }
  }
}

function bracket(angles, value) {
  if (value < angles[0] || value > angles[angles.length - 1]) return null;
  if (value === angles[0]) return [0, 0, 0];
  const last = angles.length - 1;
  if (value === angles[last]) return [last, last, 0];
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (angles[middle] <= value) low = middle;
    else high = middle;
  }
  return [low, high, (value - angles[low]) / (angles[high] - angles[low])];
}

function interpolate(angles, values, value, outside = 0) {
  const found = bracket(angles, value);
  if (!found) return outside;
  const [low, high, amount] = found;
  return values[low] + (values[high] - values[low]) * amount;
}

function normaliseHorizontal(value) {
  return ((value % 360) + 360) % 360;
}

function foldHorizontal(value, symmetry) {
  const angle = normaliseHorizontal(value);
  if (symmetry === "c0-c180") return angle > 180 ? 360 - angle : angle;
  if (symmetry === "c0-c90") {
    const half = angle % 180;
    return half > 90 ? 180 - half : half;
  }
  if (symmetry === "c90-c270") {
    if (angle < 90) return 180 - angle;
    if (angle > 270) return 540 - angle;
  }
  return angle;
}

function horizontalSample(angles, values, value, symmetry, planeStepDeg) {
  if (angles.length === 1 || symmetry === "axial") return values[0];
  const angle = foldHorizontal(value, symmetry);
  const found = bracket(angles, angle);
  if (found) {
    const [low, high, amount] = found;
    return values[low] + (values[high] - values[low]) * amount;
  }
  const last = angles.length - 1;
  const periodic = symmetry === "none" && angles[0] === 0 && planeStepDeg > 0
    && Math.abs(angles[last] + planeStepDeg - 360) < 1e-6;
  if (periodic && angle > angles[last] && angle < 360) {
    const amount = (angle - angles[last]) / planeStepDeg;
    return values[last] + (values[0] - values[last]) * amount;
  }
  return 0;
}

function makeProfile(fields) {
  const verticalAnglesDeg = fields.verticalAnglesDeg.slice();
  const horizontalAnglesDeg = fields.horizontalAnglesDeg.slice();
  const candela = fields.candela.map((row) => row.slice());
  const symmetry = fields.horizontalSymmetry;
  const planeStepDeg = fields.planeStepDeg ?? 0;

  function candelaAt(verticalDeg, horizontalDeg = 0) {
    if (!Number.isFinite(verticalDeg) || !Number.isFinite(horizontalDeg)) {
      throw new RangeError("verticalDeg and horizontalDeg must be finite numbers");
    }
    if (bracket(verticalAnglesDeg, verticalDeg) == null) return 0;
    const planes = candela.map((row) => interpolate(verticalAnglesDeg, row, verticalDeg));
    return horizontalSample(horizontalAnglesDeg, planes, horizontalDeg, symmetry, planeStepDeg);
  }

  return {
    ...fields,
    verticalAnglesDeg,
    horizontalAnglesDeg,
    candela,
    candelaAt,
  };
}

/** Sample a parsed profile with linear vertical and C-plane interpolation. */
export function sampleCandela(profile, verticalDeg, horizontalDeg = 0) {
  if (!profile || typeof profile.candelaAt !== "function") throw new TypeError("profile must be a parsed photometric profile");
  return profile.candelaAt(verticalDeg, horizontalDeg);
}

export const interpolateCandela = sampleCandela;

function iesHorizontalSymmetry(angles) {
  if (angles.length === 1 || angles[angles.length - 1] === 0) return "axial";
  if (angles[0] === 0 && angles[angles.length - 1] === 90) return "c0-c90";
  if (angles[0] === 0 && angles[angles.length - 1] === 180) return "c0-c180";
  return "none";
}

/** Parse IES LM-63-1986/1991/1995/2002 angular candela data. */
export function parseIES(text) {
  const lines = textLines(text, IES_FORMAT);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex < 0) fail(IES_FORMAT, "file is empty");
  const header = lines[headerIndex].trim();
  if (!/^IESNA(?::LM-63-(?:1986|1991|1995|2002)|91)$/i.test(header)) {
    fail(IES_FORMAT, "missing or unsupported IESNA LM-63 header", headerIndex + 1);
  }
  const tiltIndex = lines.findIndex((line, index) => index > headerIndex && /^TILT\s*=/i.test(line.trim()));
  if (tiltIndex < 0) fail(IES_FORMAT, "missing TILT record");
  const tilt = lines[tiltIndex].trim().replace(/^TILT\s*=/i, "").trim().toUpperCase();
  if (tilt !== "NONE" && tilt !== "INCLUDE") fail(IES_FORMAT, "external TILT files are not supported; use TILT=NONE or TILT=INCLUDE", tiltIndex + 1);

  const cursor = new NumericCursor(lines, tiltIndex + 1, IES_FORMAT);
  let tiltData = { type: tilt };
  if (tilt === "INCLUDE") {
    const lampCount = cursor.integer("TILT lamp count", 0);
    const pairCount = cursor.integer("TILT angle/multiplier pair count", 1);
    const anglesDeg = increasing(cursor.values(pairCount, "TILT angle"), IES_FORMAT, "TILT angles");
    const multipliers = cursor.values(pairCount, "TILT multiplier");
    if (multipliers.some((value) => value < 0)) fail(IES_FORMAT, "TILT multipliers must be >= 0");
    tiltData = { type: tilt, lampCount, anglesDeg, multipliers };
  }

  const numberOfLamps = cursor.integer("number of lamps", 1);
  const lumensItem = cursor.read("lumens per lamp");
  const lumensPerLamp = lumensItem.value;
  if (lumensPerLamp !== -1 && lumensPerLamp <= 0) fail(IES_FORMAT, "lumens per lamp must be > 0, or -1 for absolute photometry", lumensItem.line);
  const multiplierItem = cursor.read("candela multiplier");
  const candelaMultiplier = multiplierItem.value;
  if (candelaMultiplier < 0) fail(IES_FORMAT, "candela multiplier must be >= 0", multiplierItem.line);
  const verticalCount = cursor.integer("vertical angle count", 1);
  const horizontalCount = cursor.integer("horizontal angle count", 1);
  const typeItem = cursor.read("photometric type");
  const photometricType = requireInteger(typeItem.value, IES_FORMAT, "photometric type", typeItem.line);
  if (![1, 2, 3].includes(photometricType)) fail(IES_FORMAT, "photometric type must be 1 (C), 2 (B), or 3 (A)", typeItem.line);
  const unitsItem = cursor.read("units type");
  const unitsType = requireInteger(unitsItem.value, IES_FORMAT, "units type", unitsItem.line);
  if (![1, 2].includes(unitsType)) fail(IES_FORMAT, "units type must be 1 (feet) or 2 (metres)", unitsItem.line);
  const luminousOpening = cursor.values(3, "luminous opening dimension");
  if (luminousOpening.some((value) => value < 0)) fail(IES_FORMAT, "luminous opening dimensions must be >= 0");
  const ballastFactor = cursor.read("ballast factor").value;
  const futureUse = cursor.read("future use").value;
  const inputWatts = cursor.read("input watts").value;
  const verticalAnglesDeg = increasing(cursor.values(verticalCount, "vertical angle"), IES_FORMAT, "vertical angles");
  const horizontalAnglesDeg = increasing(cursor.values(horizontalCount, "horizontal angle"), IES_FORMAT, "horizontal angles");
  const rawCandela = Array.from({ length: horizontalCount }, () => cursor.values(verticalCount, "candela value"));
  cursor.ensureEnd();
  if (rawCandela.some((row) => row.some((value) => value < 0))) fail(IES_FORMAT, "candela values must be >= 0");

  const absolute = lumensPerLamp === -1;
  const scale = candelaMultiplier * (absolute ? 1 : lumensPerLamp / 1000);
  const candela = rawCandela.map((row) => row.map((value) => value * scale));
  return makeProfile({
    format: IES_FORMAT,
    standard: header,
    photometricType,
    units: unitsType === 2 ? "metres" : "feet",
    verticalAnglesDeg,
    horizontalAnglesDeg,
    horizontalSymmetry: iesHorizontalSymmetry(horizontalAnglesDeg),
    candela,
    luminousFluxLm: absolute ? null : numberOfLamps * lumensPerLamp,
    metadata: {
      numberOfLamps,
      lumensPerLamp,
      absolute,
      candelaMultiplier,
      unitsType,
      luminousOpening,
      ballastFactor,
      futureUse,
      inputWatts,
      tilt: tiltData,
    },
  });
}

function ldtHeaderNumber(lines, index, label) {
  if (index >= lines.length) fail(LDT_FORMAT, `missing ${label}`, index + 1);
  return toNumber(lines[index], LDT_FORMAT, label, index + 1);
}

function ldtHeaderInteger(lines, index, label, minimum = null) {
  return requireInteger(ldtHeaderNumber(lines, index, label), LDT_FORMAT, label, index + 1, minimum);
}

/** Parse line-oriented EULUMDAT LDT angular candela data (cd/1000 lm). */
export function parseLDT(text) {
  const allLines = textLines(text, LDT_FORMAT);
  const base = allLines.findIndex((line) => line.trim().length > 0);
  if (base < 0) fail(LDT_FORMAT, "file is empty");
  const lines = allLines.slice(base);
  if (lines.length < 26) fail(LDT_FORMAT, "truncated header");
  const typeIndicator = ldtHeaderInteger(lines, 1, "luminaire type indicator");
  if (![1, 2, 3].includes(typeIndicator)) fail(LDT_FORMAT, "luminaire type indicator must be 1, 2, or 3", base + 2);
  const symmetryIndicator = ldtHeaderInteger(lines, 2, "symmetry indicator");
  if (![0, 1, 2, 3, 4].includes(symmetryIndicator)) fail(LDT_FORMAT, "symmetry indicator must be 0, 1, 2, 3, or 4", base + 3);
  const planeCount = ldtHeaderInteger(lines, 3, "C-plane count", 1);
  const planeStepDeg = ldtHeaderNumber(lines, 4, "C-plane spacing");
  const verticalCount = ldtHeaderInteger(lines, 5, "vertical angle count", 1);
  const angleStepDeg = ldtHeaderNumber(lines, 6, "vertical angle spacing");
  if (planeCount > 1 && !(planeStepDeg > 0)) fail(LDT_FORMAT, "C-plane spacing must be > 0", base + 5);
  if (verticalCount > 1 && !(angleStepDeg > 0)) fail(LDT_FORMAT, "vertical angle spacing must be > 0", base + 7);
  const dimensionsMm = [12, 13, 14, 15, 16, 17, 18, 19, 20].map((index) => ldtHeaderNumber(lines, index, "luminaire dimension"));
  const downwardFluxFraction = ldtHeaderNumber(lines, 21, "downward flux fraction");
  const lightOutputRatio = ldtHeaderNumber(lines, 22, "light output ratio");
  const conversionFactor = ldtHeaderNumber(lines, 23, "candela conversion factor");
  if (!(conversionFactor > 0)) fail(LDT_FORMAT, "candela conversion factor must be > 0", base + 24);
  const measurementTiltDeg = ldtHeaderNumber(lines, 24, "measurement tilt");
  const lampSetCount = ldtHeaderInteger(lines, 25, "lamp set count", 0);

  let offset = 26;
  const lampSets = [];
  for (let set = 0; set < lampSetCount; set += 1) {
    if (offset + 5 >= lines.length) fail(LDT_FORMAT, `truncated lamp set ${set + 1}`, base + offset + 1);
    const lampCount = ldtHeaderInteger(lines, offset, `lamp set ${set + 1} lamp count`, 1);
    const lampType = lines[offset + 1].trim();
    const luminousFluxLm = ldtHeaderNumber(lines, offset + 2, `lamp set ${set + 1} luminous flux`);
    const colorAppearance = lines[offset + 3].trim();
    const colorRendering = lines[offset + 4].trim();
    const wattage = ldtHeaderNumber(lines, offset + 5, `lamp set ${set + 1} wattage`);
    if (luminousFluxLm < 0 || wattage < 0) fail(LDT_FORMAT, `lamp set ${set + 1} flux and wattage must be >= 0`, base + offset + 1);
    lampSets.push({ lampCount, lampType, luminousFluxLm, colorAppearance, colorRendering, wattage });
    offset += 6;
  }

  const cursor = new NumericCursor(lines, offset, LDT_FORMAT);
  const directRatios = Array.from({ length: planeCount }, () => cursor.values(10, "direct ratio"));
  const horizontalAnglesDeg = increasing(cursor.values(planeCount, "C-plane angle"), LDT_FORMAT, "C-plane angles");
  const verticalAnglesDeg = increasing(cursor.values(verticalCount, "vertical angle"), LDT_FORMAT, "vertical angles");
  const rawCandela = Array.from({ length: planeCount }, () => cursor.values(verticalCount, "candela value"));
  if (rawCandela.some((row) => row.some((value) => value < 0))) fail(LDT_FORMAT, "candela values must be >= 0");
  const candela = rawCandela.map((row) => row.map((value) => (value * conversionFactor) / 1000));
  const horizontalSymmetry = typeIndicator === 1 || symmetryIndicator === 1 ? "axial"
    : symmetryIndicator === 2 ? "c0-c180"
      : symmetryIndicator === 3 ? "c90-c270"
        : symmetryIndicator === 4 ? "c0-c90" : "none";

  return makeProfile({
    format: LDT_FORMAT,
    standard: "EULUMDAT",
    photometricType: "C",
    units: "millimetres",
    verticalAnglesDeg,
    horizontalAnglesDeg,
    horizontalSymmetry,
    planeStepDeg,
    candela,
    luminousFluxLm: lampSets.reduce((sum, set) => sum + set.luminousFluxLm, 0),
    metadata: {
      company: lines[0].trim(),
      typeIndicator,
      symmetryIndicator,
      planeStepDeg,
      angleStepDeg,
      measurementReport: lines[7].trim(),
      luminaireName: lines[8].trim(),
      luminaireNumber: lines[9].trim(),
      fileName: lines[10].trim(),
      dateAndUser: lines[11].trim(),
      dimensionsMm,
      downwardFluxFraction,
      lightOutputRatio,
      conversionFactor,
      measurementTiltDeg,
      lampSets,
      directRatios,
    },
  });
}

export const parseIESLM63 = parseIES;
export const parseEULUMDAT = parseLDT;

/** Auto-detect an IESNA header; otherwise parse the line-oriented EULUMDAT form. */
export function parsePhotometricProfile(text) {
  const first = typeof text === "string" ? text.replace(/^\uFEFF/, "").trimStart().split(/\r?\n/, 1)[0] : "";
  return /^IESNA/i.test(first) ? parseIES(text) : parseLDT(text);
}
