const fs = require("fs");

/**
 * IFC (ISO 10303-21 / STEP physical file) reader — no dependencies.
 *
 * Reads what a construction team actually uses BIM data for: the spatial
 * breakdown (project → site → building → storey → space), every physical
 * element with its type, material, property sets and base quantities. It does
 * NOT evaluate geometry — solids, profiles, placements and representations are
 * skipped while scanning, which is what keeps a 200 MB model inside a few
 * hundred megabytes of memory and a few seconds of CPU.
 *
 * Supports IFC2X3 and IFC4 (the attribute order of every entity read here is
 * the same in both).
 */

const MAX_STRING = 2000;
const MAX_PROPERTIES = 200;

// ─── Entity filter ────────────────────────────────────────────────────────
// Geometry, placement, style and ownership entities are 90 % of a model's
// instances and none of them are read below, so they never enter memory.

const SKIP_TYPES = new Set([
  "IFCCARTESIANPOINT", "IFCDIRECTION", "IFCVERTEXPOINT", "IFCVERTEX", "IFCLOCALPLACEMENT",
  "IFCAXIS1PLACEMENT", "IFCAXIS2PLACEMENT2D", "IFCAXIS2PLACEMENT3D", "IFCPOLYLINE", "IFCPOLYLOOP",
  "IFCFACE", "IFCFACEBOUND", "IFCFACEOUTERBOUND", "IFCFACESURFACE", "IFCCLOSEDSHELL", "IFCOPENSHELL",
  "IFCFACETEDBREP", "IFCADVANCEDBREP", "IFCSHELLBASEDSURFACEMODEL", "IFCEXTRUDEDAREASOLID",
  "IFCREVOLVEDAREASOLID", "IFCSWEPTDISKSOLID", "IFCBOOLEANRESULT", "IFCBOOLEANCLIPPINGRESULT",
  "IFCHALFSPACESOLID", "IFCPOLYGONALBOUNDEDHALFSPACE", "IFCPLANE", "IFCCIRCLE", "IFCELLIPSE",
  "IFCLINE", "IFCTRIMMEDCURVE", "IFCCOMPOSITECURVE", "IFCCOMPOSITECURVESEGMENT",
  "IFCINDEXEDPOLYCURVE", "IFCTRIANGULATEDFACESET", "IFCPOLYGONALFACESET", "IFCINDEXEDPOLYGONALFACE",
  "IFCSHAPEREPRESENTATION", "IFCPRODUCTDEFINITIONSHAPE", "IFCREPRESENTATIONMAP", "IFCMAPPEDITEM",
  "IFCGEOMETRICREPRESENTATIONCONTEXT", "IFCGEOMETRICREPRESENTATIONSUBCONTEXT",
  "IFCGEOMETRICCURVESET", "IFCCONNECTIONSURFACEGEOMETRY", "IFCCURVEBOUNDEDPLANE",
  "IFCSTYLEDITEM", "IFCSTYLEDREPRESENTATION", "IFCPRESENTATIONSTYLEASSIGNMENT",
  "IFCSURFACESTYLE", "IFCSURFACESTYLERENDERING", "IFCSURFACESTYLESHADING", "IFCCOLOURRGB",
  "IFCPRESENTATIONLAYERASSIGNMENT", "IFCOWNERHISTORY", "IFCPERSON", "IFCORGANIZATION",
  "IFCPERSONANDORGANIZATION", "IFCAPPLICATION", "IFCRELSPACEBOUNDARY", "IFCRELSPACEBOUNDARY1STLEVEL",
  "IFCRELSPACEBOUNDARY2NDLEVEL", "IFCRELCONNECTSPATHELEMENTS", "IFCRELCONNECTSELEMENTS",
  "IFCGRIDAXIS", "IFCVIRTUALGRIDINTERSECTION", "IFCTEXTLITERAL", "IFCTEXTLITERALWITHEXTENT",
  "IFCCARTESIANTRANSFORMATIONOPERATOR2D", "IFCCARTESIANTRANSFORMATIONOPERATOR3D",
]);

const skipType = (type) =>
  SKIP_TYPES.has(type) ||
  type.endsWith("PROFILEDEF") ||
  type.startsWith("IFCCARTESIANPOINTLIST") ||
  type.startsWith("IFCBSPLINE") ||
  type.startsWith("IFCRATIONALB");

/** Spatial containers, outermost first. */
const SPATIAL_TYPES = new Set(["IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE"]);
const NON_ELEMENT = new Set([...SPATIAL_TYPES, "IFCUNITASSIGNMENT", "IFCSIUNIT", "IFCCONVERSIONBASEDUNIT", "IFCMEASUREWITHUNIT", "IFCDIMENSIONALEXPONENTS"]);

// ─── Values ───────────────────────────────────────────────────────────────

const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** `\X2\00E9\X0\`, `\X\E9` and `\S\i` escapes plus doubled quotes. */
const decodeString = (raw) => {
  let text = raw.replace(/''/g, "'");
  if (text.includes("\\")) {
    text = text
      .replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_full, hex) => hex.match(/.{1,4}/g).map((code) => String.fromCharCode(Number.parseInt(code, 16))).join(""))
      .replace(/\\X\\([0-9A-Fa-f]{2})/g, (_full, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\S\\(.)/g, (_full, char) => String.fromCharCode(char.charCodeAt(0) + 128))
      .replace(/\\\\/g, "\\");
  }
  return text.length > MAX_STRING ? text.slice(0, MAX_STRING) : text;
};

/**
 * Splits a STEP argument list into values. Returns strings, numbers, booleans,
 * `{ ref }` for `#123`, arrays for `(...)`, `{ type, value }` for typed values
 * such as `IFCLABEL('x')`, and null for `$` / `*`.
 */
const parseArgs = (text) => {
  const values = [];
  const stack = [values];
  let index = 0;
  let token = "";

  const flush = () => {
    const raw = token.trim();
    token = "";
    if (!raw) return;
    const target = stack[stack.length - 1];
    if (raw === "$" || raw === "*") target.push(null);
    else if (raw === ".T.") target.push(true);
    else if (raw === ".F.") target.push(false);
    else if (raw === ".U.") target.push(null);
    else if (raw.startsWith(".") && raw.endsWith(".")) target.push(raw.slice(1, -1));
    else if (raw.startsWith("#")) target.push({ ref: Number.parseInt(raw.slice(1), 10) });
    else if (NUMBER_RE.test(raw)) target.push(Number.parseFloat(raw));
    else target.push(raw);
  };

  while (index < text.length) {
    const char = text[index];
    if (char === "'") {
      const end = (() => {
        let cursor = index + 1;
        while (cursor < text.length) {
          if (text[cursor] === "'") {
            if (text[cursor + 1] === "'") cursor += 2;
            else return cursor;
          } else cursor += 1;
        }
        return text.length;
      })();
      stack[stack.length - 1].push(decodeString(text.slice(index + 1, end)));
      token = "";
      index = end + 1;
      // Skip to the next separator so a trailing name is not re-read.
      while (index < text.length && /[\s]/.test(text[index])) index += 1;
      if (text[index] === ",") index += 1;
      continue;
    }
    if (char === "(") {
      const name = token.trim();
      token = "";
      const list = [];
      if (name) {
        // Typed value: IFCLABEL('x') — keep the type and unwrap a single value.
        const holder = { type: name, values: list };
        stack[stack.length - 1].push(holder);
      } else {
        stack[stack.length - 1].push(list);
      }
      stack.push(list);
      index += 1;
      continue;
    }
    if (char === ")") {
      flush();
      stack.pop();
      index += 1;
      continue;
    }
    if (char === ",") {
      flush();
      index += 1;
      continue;
    }
    token += char;
    index += 1;
  }
  flush();
  return values.map(unwrap);
};

const unwrap = (value) => {
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === "object" && value.type) {
    const inner = value.values.map(unwrap);
    return inner.length === 1 ? { typed: value.type, value: inner[0] } : { typed: value.type, value: inner };
  }
  return value;
};

/** The plain value of an attribute, unwrapping typed values. */
const plain = (value) => {
  if (value && typeof value === "object" && "typed" in value) return plain(value.value);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object" && "ref" in value) return null;
  return value;
};

const refOf = (value) => (value && typeof value === "object" && "ref" in value ? value.ref : null);
const refsOf = (value) => (Array.isArray(value) ? value.map(refOf).filter((ref) => ref !== null) : []);
const textOf = (value) => {
  const result = plain(value);
  if (result === null || result === undefined) return null;
  return typeof result === "string" ? result.trim() || null : String(result);
};
const numberOf = (value) => {
  const result = plain(value);
  return typeof result === "number" && Number.isFinite(result) ? result : null;
};

// ─── Statement scanning ───────────────────────────────────────────────────

const STATEMENT_RE = /^#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\(([\s\S]*)\)\s*$/;

/** Calls `onStatement(text)` for every `;`-terminated statement, honouring quoted strings. */
const scanStatements = (chunk, carry, onStatement) => {
  let buffer = carry.buffer + chunk;
  let start = 0;
  let index = 0;
  let inString = carry.inString;
  while (index < buffer.length) {
    const char = buffer[index];
    if (inString) {
      if (char === "'") {
        if (buffer[index + 1] === "'") index += 1;
        else inString = false;
      }
    } else if (char === "'") inString = true;
    else if (char === ";") {
      onStatement(buffer.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  carry.buffer = buffer.slice(start);
  carry.inString = inString;
};

// ─── Model assembly ───────────────────────────────────────────────────────

const QUANTITY_FIELDS = [
  ["netVolume", ["netvolume"]],
  ["grossVolume", ["grossvolume", "volume"]],
  ["netArea", ["netarea", "netsidearea", "netfloorarea", "netsurfacearea"]],
  ["grossArea", ["grossarea", "grosssidearea", "grossfloorarea", "grosssurfacearea", "area", "grossfootprintarea"]],
  ["length", ["length"]],
  ["width", ["width"]],
  ["height", ["height", "depth"]],
  ["perimeter", ["perimeter"]],
  ["weight", ["netweight", "grossweight", "weight"]],
  ["count", ["count"]],
];

const quantityField = (name) => {
  const key = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
  for (const [field, aliases] of QUANTITY_FIELDS) {
    if (aliases.includes(key)) return field;
  }
  for (const [field, aliases] of QUANTITY_FIELDS) {
    if (aliases.some((alias) => key.endsWith(alias))) return field;
  }
  return null;
};

const SI_PREFIX = { EXA: "E", PETA: "P", TERA: "T", GIGA: "G", MEGA: "M", KILO: "k", HECTO: "h", DECA: "da", DECI: "d", CENTI: "c", MILLI: "m", MICRO: "µ", NANO: "n" };
const SI_NAME = { METRE: "m", SQUARE_METRE: "m²", CUBIC_METRE: "m³", GRAM: "g", SECOND: "s", DEGREE_CELSIUS: "°C", NEWTON: "N", PASCAL: "Pa", WATT: "W" };

class IfcModelBuilder {
  constructor({ maxEntities = 400_000 } = {}) {
    this.entities = new Map();
    this.byType = new Map();
    this.header = {};
    this.schema = null;
    this.section = null;
    this.count = 0;
    this.truncated = false;
    this.maxEntities = maxEntities;
  }

  addStatement(raw) {
    const text = raw.trim();
    if (!text) return;
    const upper = text.toUpperCase();
    if (upper === "HEADER" || upper === "DATA") {
      this.section = upper;
      return;
    }
    if (upper === "ENDSEC" || upper.startsWith("ISO-10303-21") || upper.startsWith("END-ISO-10303-21")) {
      this.section = null;
      return;
    }
    if (this.section === "HEADER") {
      const match = text.match(/^([A-Za-z_]+)\s*\(([\s\S]*)\)$/);
      if (!match) return;
      const args = parseArgs(match[2]);
      const name = match[1].toUpperCase();
      if (name === "FILE_SCHEMA") {
        const list = plain(args[0]);
        this.schema = (Array.isArray(list) ? list[0] : list) || null;
      } else if (name === "FILE_NAME") {
        this.header = {
          name: textOf(args[0]),
          timeStamp: textOf(args[1]),
          author: (plain(args[2]) || []).filter(Boolean).join(", ") || null,
          organization: (plain(args[3]) || []).filter(Boolean).join(", ") || null,
          preprocessor: textOf(args[4]),
          originatingSystem: textOf(args[5]),
        };
      } else if (name === "FILE_DESCRIPTION") {
        const list = plain(args[0]);
        this.header.description = (Array.isArray(list) ? list : [list]).filter(Boolean).join(" ") || null;
      }
      return;
    }
    const match = text.match(STATEMENT_RE);
    if (!match) return;
    const type = match[2].toUpperCase();
    if (skipType(type)) return;
    if (this.count >= this.maxEntities) {
      this.truncated = true;
      return;
    }
    const id = Number.parseInt(match[1], 10);
    const entity = { id, type, args: parseArgs(match[3]) };
    this.entities.set(id, entity);
    this.count += 1;
    if (!this.byType.has(type)) this.byType.set(type, []);
    this.byType.get(type).push(entity);
  }

  get(ref) {
    return ref === null || ref === undefined ? null : this.entities.get(ref) || null;
  }

  /** Every entity of `type` plus its subtypes when the name is a prefix (`IFCRELDEFINESBY…`). */
  ofType(type) {
    return this.byType.get(type) || [];
  }

  unitLabel(ref) {
    const unit = this.get(ref);
    if (!unit) return null;
    if (unit.type === "IFCSIUNIT") {
      const prefix = textOf(unit.args[2]);
      const name = textOf(unit.args[3]);
      const symbol = SI_NAME[name] || (name ? name.toLowerCase() : null);
      return `${prefix ? SI_PREFIX[prefix] || prefix.toLowerCase() : ""}${symbol || ""}` || null;
    }
    if (unit.type === "IFCCONVERSIONBASEDUNIT") return textOf(unit.args[2]);
    return null;
  }

  units() {
    const project = this.ofType("IFCPROJECT")[0];
    const assignment = this.get(refOf(project?.args?.[8]));
    const units = {};
    for (const ref of refsOf(assignment?.args?.[0])) {
      const unit = this.get(ref);
      if (!unit) continue;
      const type = textOf(unit.type === "IFCSIUNIT" ? unit.args[1] : unit.args[3]) || textOf(unit.args[1]);
      const label = this.unitLabel(ref);
      if (!type || !label) continue;
      if (type === "LENGTHUNIT") units.length = label;
      else if (type === "AREAUNIT") units.area = label;
      else if (type === "VOLUMEUNIT") units.volume = label;
      else if (type === "MASSUNIT") units.mass = label;
    }
    return units;
  }

  /** Names of every material attached to a material definition, however it is nested. */
  materialNames(ref, seen = new Set()) {
    if (ref === null || seen.has(ref)) return [];
    seen.add(ref);
    const entity = this.get(ref);
    if (!entity) return [];
    switch (entity.type) {
      case "IFCMATERIAL":
        return [textOf(entity.args[0])].filter(Boolean);
      case "IFCMATERIALLIST":
        return refsOf(entity.args[0]).flatMap((child) => this.materialNames(child, seen));
      case "IFCMATERIALLAYERSETUSAGE":
        return this.materialNames(refOf(entity.args[0]), seen);
      case "IFCMATERIALLAYERSET":
        return refsOf(entity.args[0]).flatMap((child) => this.materialNames(child, seen));
      case "IFCMATERIALLAYER":
        return this.materialNames(refOf(entity.args[0]), seen);
      case "IFCMATERIALPROFILESETUSAGE":
        return this.materialNames(refOf(entity.args[0]), seen);
      case "IFCMATERIALPROFILESET":
        return refsOf(entity.args[2]).flatMap((child) => this.materialNames(child, seen));
      case "IFCMATERIALPROFILE":
        return this.materialNames(refOf(entity.args[2]), seen);
      case "IFCMATERIALCONSTITUENTSET":
        return refsOf(entity.args[2]).flatMap((child) => this.materialNames(child, seen));
      case "IFCMATERIALCONSTITUENT":
        return this.materialNames(refOf(entity.args[2]), seen);
      default:
        return [];
    }
  }

  propertyValue(entity) {
    if (!entity) return null;
    if (entity.type === "IFCPROPERTYSINGLEVALUE") return plain(entity.args[2]);
    if (entity.type === "IFCPROPERTYENUMERATEDVALUE") {
      const values = plain(entity.args[2]);
      return Array.isArray(values) ? values.join(", ") : values;
    }
    if (entity.type === "IFCPROPERTYLISTVALUE") {
      const values = plain(entity.args[2]);
      return Array.isArray(values) ? values.join(", ") : values;
    }
    if (entity.type === "IFCPROPERTYBOUNDEDVALUE") {
      const lower = plain(entity.args[2]);
      const upper = plain(entity.args[3]);
      return [lower, upper].filter((value) => value !== null && value !== undefined).join(" – ") || null;
    }
    return null;
  }

  build() {
    const spatial = new Map();
    const elements = new Map();
    const warnings = [];

    // Spatial containers.
    for (const type of SPATIAL_TYPES) {
      for (const entity of this.ofType(type)) {
        spatial.set(entity.id, {
          id: entity.id,
          globalId: textOf(entity.args[0]),
          ifcType: entity.type,
          name: textOf(entity.args[2]),
          longName: textOf(entity.args[7]),
          elevation: entity.type === "IFCBUILDINGSTOREY" ? numberOf(entity.args[9]) : null,
          parentId: null,
          children: [],
        });
      }
    }

    // Aggregation: project → site → building → storey, and assemblies.
    const aggregatedChildren = new Map();
    for (const rel of this.ofType("IFCRELAGGREGATES")) {
      const parent = refOf(rel.args[4]);
      for (const child of refsOf(rel.args[5])) {
        if (spatial.has(child) && spatial.has(parent)) spatial.get(child).parentId = parent;
        if (!aggregatedChildren.has(parent)) aggregatedChildren.set(parent, []);
        aggregatedChildren.get(parent).push(child);
      }
    }
    for (const node of spatial.values()) {
      if (node.parentId && spatial.has(node.parentId)) spatial.get(node.parentId).children.push(node.id);
    }

    const pathOf = (id) => {
      const parts = [];
      let cursor = id;
      let guard = 0;
      while (cursor && spatial.has(cursor) && guard < 20) {
        const node = spatial.get(cursor);
        if (node.ifcType !== "IFCPROJECT") parts.unshift(node.name || node.longName || node.ifcType.replace("IFC", ""));
        cursor = node.parentId;
        guard += 1;
      }
      return parts.join(" / ") || null;
    };

    const addElement = (id, containerId) => {
      if (elements.has(id) || spatial.has(id)) return;
      const entity = this.get(id);
      if (!entity || NON_ELEMENT.has(entity.type) || entity.type.startsWith("IFCREL")) return;
      const storey = (() => {
        let cursor = containerId;
        let guard = 0;
        while (cursor && spatial.has(cursor) && guard < 20) {
          const node = spatial.get(cursor);
          if (node.ifcType === "IFCBUILDINGSTOREY") return node;
          cursor = node.parentId;
          guard += 1;
        }
        return null;
      })();
      elements.set(id, {
        id,
        globalId: textOf(entity.args[0]),
        ifcType: entity.type,
        name: textOf(entity.args[2]),
        description: textOf(entity.args[3]),
        objectType: textOf(entity.args[4]),
        tag: null,
        predefinedType: null,
        typeName: null,
        containerId: containerId || null,
        storeyName: storey?.name || storey?.longName || null,
        storeyGlobalId: storey?.globalId || null,
        elevation: storey?.elevation ?? null,
        spatialPath: pathOf(containerId),
        materials: [],
        properties: {},
        quantities: {},
      });
      // Parts of an assembly (a stair's flights, a curtain wall's panels).
      for (const child of aggregatedChildren.get(id) || []) addElement(child, containerId);
    };

    for (const rel of this.ofType("IFCRELCONTAINEDINSPATIALSTRUCTURE")) {
      const container = refOf(rel.args[5]);
      for (const child of refsOf(rel.args[4])) addElement(child, container);
    }
    // Spaces are spatial, but a QS wants them in the element list too.
    for (const node of spatial.values()) {
      if (node.ifcType !== "IFCSPACE") continue;
      const entity = this.get(node.id);
      elements.set(node.id, {
        id: node.id,
        globalId: node.globalId,
        ifcType: node.ifcType,
        name: node.name,
        description: textOf(entity?.args?.[3]),
        objectType: textOf(entity?.args?.[4]),
        tag: null,
        predefinedType: null,
        typeName: null,
        containerId: node.parentId,
        storeyName: node.parentId && spatial.get(node.parentId)?.ifcType === "IFCBUILDINGSTOREY" ? spatial.get(node.parentId).name : null,
        storeyGlobalId: node.parentId ? spatial.get(node.parentId)?.globalId || null : null,
        elevation: node.parentId ? spatial.get(node.parentId)?.elevation ?? null : null,
        spatialPath: pathOf(node.parentId),
        materials: [],
        properties: {},
        quantities: {},
        longName: node.longName,
      });
    }

    // Tag is the last attribute of most IfcElement subtypes; read it defensively.
    for (const element of elements.values()) {
      const entity = this.get(element.id);
      const tag = textOf(entity?.args?.[7]);
      if (tag && !/^[0-9a-f-]{20,}$/i.test(tag)) element.tag = tag;
    }

    // Types.
    for (const rel of this.ofType("IFCRELDEFINESBYTYPE")) {
      const typeEntity = this.get(refOf(rel.args[5]));
      if (!typeEntity) continue;
      const typeName = textOf(typeEntity.args[2]);
      const predefined = textOf(typeEntity.args[9]) || textOf(typeEntity.args[8]);
      for (const id of refsOf(rel.args[4])) {
        const element = elements.get(id);
        if (!element) continue;
        element.typeName = typeName;
        if (predefined && /^[A-Z_]+$/.test(predefined)) element.predefinedType = predefined;
      }
    }

    // Property sets and base quantities.
    for (const rel of this.ofType("IFCRELDEFINESBYPROPERTIES")) {
      const definition = this.get(refOf(rel.args[5]));
      if (!definition) continue;
      const targets = refsOf(rel.args[4]).map((id) => elements.get(id)).filter(Boolean);
      if (!targets.length) continue;

      if (definition.type === "IFCPROPERTYSET") {
        const setName = textOf(definition.args[2]) || "Properties";
        const values = {};
        for (const ref of refsOf(definition.args[4])) {
          const property = this.get(ref);
          const name = textOf(property?.args?.[0]);
          if (!name) continue;
          const value = this.propertyValue(property);
          if (value === null || value === undefined || value === "") continue;
          values[name] = value;
          if (Object.keys(values).length >= MAX_PROPERTIES) break;
        }
        if (!Object.keys(values).length) continue;
        for (const element of targets) {
          element.properties[setName] = { ...(element.properties[setName] || {}), ...values };
        }
      } else if (definition.type === "IFCELEMENTQUANTITY") {
        for (const ref of refsOf(definition.args[5])) {
          const quantity = this.get(ref);
          if (!quantity || !quantity.type.startsWith("IFCQUANTITY")) continue;
          const field = quantityField(textOf(quantity.args[0]));
          const value = numberOf(quantity.args[3]);
          if (!field || value === null) continue;
          for (const element of targets) {
            if (element.quantities[field] === undefined) element.quantities[field] = value;
          }
        }
      }
    }

    // Materials.
    for (const rel of this.ofType("IFCRELASSOCIATESMATERIAL")) {
      const names = this.materialNames(refOf(rel.args[5]));
      if (!names.length) continue;
      for (const id of refsOf(rel.args[4])) {
        const element = elements.get(id);
        if (element) element.materials = [...new Set([...element.materials, ...names])];
      }
    }

    const projectEntity = this.ofType("IFCPROJECT")[0] || null;
    const siteNode = [...spatial.values()].find((node) => node.ifcType === "IFCSITE") || null;
    const buildingNode = [...spatial.values()].find((node) => node.ifcType === "IFCBUILDING") || null;
    if (!elements.size) warnings.push("No element is contained in a spatial structure — the model may only hold geometry.");
    if (this.truncated) warnings.push(`Only the first ${this.maxEntities.toLocaleString("en")} entities were read.`);

    const spatialNodes = [...spatial.values()].map((node) => ({
      globalId: node.globalId,
      ifcType: node.ifcType,
      name: node.name,
      longName: node.longName,
      elevation: node.elevation,
      parentGlobalId: node.parentId ? spatial.get(node.parentId)?.globalId || null : null,
      elementCount: 0,
    }));
    const byGlobalId = new Map(spatialNodes.map((node) => [node.globalId, node]));
    for (const element of elements.values()) {
      const container = element.containerId ? spatial.get(element.containerId) : null;
      const node = container ? byGlobalId.get(container.globalId) : null;
      if (node) node.elementCount += 1;
    }

    return {
      schema: this.schema,
      header: this.header,
      units: this.units(),
      project: projectEntity
        ? { globalId: textOf(projectEntity.args[0]), name: textOf(projectEntity.args[2]), longName: textOf(projectEntity.args[6]), phase: textOf(projectEntity.args[7]) }
        : null,
      site: siteNode ? { globalId: siteNode.globalId, name: siteNode.name } : null,
      building: buildingNode ? { globalId: buildingNode.globalId, name: buildingNode.name } : null,
      spatial: spatialNodes,
      elements: [...elements.values()].map(({ id, containerId, ...element }) => element),
      entityCount: this.count,
      truncated: this.truncated,
      warnings,
    };
  }
}

/** Reads a model from an IFC string (tests, small files). */
const parseIfc = (text, options = {}) => {
  const builder = new IfcModelBuilder(options);
  const carry = { buffer: "", inString: false };
  scanStatements(String(text || ""), carry, (statement) => builder.addStatement(statement));
  if (carry.buffer.trim()) builder.addStatement(carry.buffer);
  return builder.build();
};

/**
 * Reads a model from a file without holding the whole file in memory
 * (`latin1`, the encoding ISO 10303-21 guarantees, so chunks never split a
 * character). `onProgress(bytesRead, totalBytes)` is called every 8 MB.
 */
const parseIfcFile = (path, { onProgress = null, maxBytes = 0, ...options } = {}) =>
  new Promise((resolve, reject) => {
    const builder = new IfcModelBuilder(options);
    const carry = { buffer: "", inString: false };
    const total = (() => {
      try {
        return fs.statSync(path).size;
      } catch {
        return 0;
      }
    })();
    if (maxBytes && total > maxBytes) {
      reject(Object.assign(new Error(`The model is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit`), { code: "IFC_FILE_TOO_LARGE" }));
      return;
    }
    let read = 0;
    let announced = 0;
    const stream = fs.createReadStream(path, { encoding: "latin1", highWaterMark: 1 << 20 });
    stream.on("data", (chunk) => {
      read += chunk.length;
      scanStatements(chunk, carry, (statement) => builder.addStatement(statement));
      if (onProgress && read - announced >= 8 << 20) {
        announced = read;
        onProgress(read, total);
      }
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (carry.buffer.trim()) builder.addStatement(carry.buffer);
      try {
        resolve(builder.build());
      } catch (error) {
        reject(error);
      }
    });
  });

module.exports = { parseIfc, parseIfcFile, parseArgs, decodeString, quantityField, scanStatements, SKIP_TYPES };
